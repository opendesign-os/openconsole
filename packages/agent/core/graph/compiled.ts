import {
  nodeId,
  run,
  unpack,
  type Graph,
  type NodeId,
} from "@openconsole/graph";

import {
  check,
  GraphValueError,
  lookup,
  ValidationError,
  type Kind,
  type Registry,
  type ToolFields,
  type Values,
  type Weight,
} from "../common";
import {
  outline,
  resume,
  save,
  Session,
  type Outline,
  type SessionEvents,
  type SessionOptions,
  type State,
  type Trace,
} from "../runtime";
import type { Checkpoint, Checkpointer } from "./checkpoint";
import { Command } from "./command";
import type {
  RunnableConfig,
  StateSnapshot,
  StateTask,
  StateValues,
  StreamConfig,
  StreamMode,
} from "./config";

export interface CompileOptions {
  readonly checkpointer?: Checkpointer;
  readonly interruptBefore?: readonly string[];
  readonly interruptAfter?: readonly string[];
  readonly name?: string;
}

type Input = Values | Command | null;

type Observer = (
  type: keyof SessionEvents,
  event: unknown,
  session: Session,
) => void;

interface Start {
  readonly input: Values;
  readonly trace: Trace | undefined;
  readonly parent: string | undefined;
}

export class CompiledFlowGraph {
  public readonly name: string;

  public constructor(
    private readonly _template: Graph<Weight>,
    private readonly _kinds: Registry,
    private readonly _options: CompileOptions = {},
  ) {
    this.name = _options.name ?? "flow";
  }

  public invoke(
    input: Input,
    config: RunnableConfig = {},
  ): Promise<StateValues> {
    return this._run(input, config, () => {});
  }

  public async stream(
    input: Input,
    config: StreamConfig = {},
  ): Promise<AsyncGenerator<unknown, void, undefined>> {
    const requested = config.streamMode ?? "values";
    const modes: readonly StreamMode[] =
      typeof requested === "string" ? [requested] : requested;
    const tagged = typeof requested !== "string";
    const channel = new Channel<unknown>();
    const send = (mode: StreamMode, chunk: unknown): void => {
      if (modes.includes(mode)) channel.push(tagged ? [mode, chunk] : chunk);
    };
    let values: Values | undefined;
    this._run(input, config, (type, event, session) => {
      send("debug", {
        type,
        timestamp: new Date().toISOString(),
        payload: event,
      });
      if (type === "finished") {
        const { node, outputs } = event as SessionEvents["finished"];
        send("updates", { [node]: outputs });
        if (session.values !== values) {
          values = session.values;
          send("values", values);
        }
      } else if (type === "interrupted") {
        const { node, value } = event as SessionEvents["interrupted"];
        send("updates", { __interrupt__: [{ id: node, value }] });
      } else if (type === "delta") {
        const { node, text } = event as SessionEvents["delta"];
        send("messages", [text, { node }]);
      } else if (type === "custom") {
        send("custom", (event as SessionEvents["custom"]).chunk);
      }
    }).then(
      () => channel.close(),
      (error: unknown) => channel.fail(error),
    );
    return channel.drain();
  }

  public async getState(config: RunnableConfig): Promise<StateSnapshot> {
    const checkpoint = await this._load(config);
    if (checkpoint === undefined) {
      return {
        values: {},
        next: [],
        tasks: [],
        config,
        parentConfig: undefined,
        createdAt: "",
      };
    }
    return this._snapshot(checkpoint);
  }

  public async *getStateHistory(
    config: RunnableConfig,
  ): AsyncGenerator<StateSnapshot, void, undefined> {
    const saver = this._saver(config);
    for await (const checkpoint of saver.list(config)) {
      yield this._snapshot(checkpoint);
    }
  }

  public async updateState(
    config: RunnableConfig,
    values: Values,
    asNode: string,
  ): Promise<RunnableConfig> {
    const saver = this._saver(config);
    const stored = await saver.get(config);
    if (stored === undefined) {
      throw new GraphValueError("there is no saved run to update");
    }
    const graph = unpack(stored.trace.graph);
    const node = nodeId(asNode);
    const kind = lookup(this._kinds, graph.nodeWeight(node)?.kind ?? "");
    if (kind === undefined) throw new GraphValueError(`unknown node ${asNode}`);
    const problems = check(kind.outputSchema, values);
    if (problems.length > 0) {
      throw new ValidationError(`update of ${asNode}`, problems);
    }
    const stale = new Set<NodeId>();
    const queue: NodeId[] = [node];
    for (
      let current = queue.pop();
      current !== undefined;
      current = queue.pop()
    ) {
      graph.forEachOut(current, (target) => {
        if (stale.has(target)) return;
        stale.add(target);
        queue.push(target);
      });
    }
    const states = stored.trace.states.map(
      ([id, state]): readonly [NodeId, State] => {
        if (id === node) {
          return [
            id,
            {
              status: "done",
              outputs: values,
              ended: Date.now(),
              ...(state.input === undefined ? {} : { input: state.input }),
            },
          ];
        }
        return stale.has(id) ? [id, { status: "waiting" }] : [id, state];
      },
    );
    const trace: Trace = { graph: stored.trace.graph, states };
    const session = resume(trace, { kinds: this._kinds, input: stored.input });
    const checkpoint: Checkpoint = {
      id: crypto.randomUUID(),
      threadId: stored.threadId,
      parentId: stored.id,
      createdAt: new Date().toISOString(),
      input: stored.input,
      values: session.values,
      trace,
    };
    await saver.put(checkpoint);
    return {
      configurable: {
        thread_id: stored.threadId,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  public getGraph(): Outline {
    return outline(this._template);
  }

  public asTool(fields: ToolFields): Kind {
    return {
      name: fields.name,
      description: fields.description,
      inputSchema: fields.schema ?? {
        type: "object",
        properties: { task: { type: "string" } },
        required: ["task"],
      },
      outputSchema: { type: "object", properties: { result: {} } },
      run: async (input, context) => {
        const task = input["task"];
        const values = await this._run(
          typeof task === "string"
            ? { ...input, messages: [{ role: "user", content: task }] }
            : input,
          { signal: context.signal },
          (type, event) => {
            if (type === "spent") {
              context.spend((event as SessionEvents["spent"]).usage);
            } else if (type === "delta") {
              context.emit((event as SessionEvents["delta"]).text);
            }
          },
        );
        return { result: values["answer"] ?? values };
      },
    };
  }

  private async _run(
    input: Input,
    config: RunnableConfig,
    observe: Observer,
  ): Promise<StateValues> {
    const thread = config.configurable?.thread_id;
    const saver = thread === undefined ? undefined : this._options.checkpointer;
    const stored = saver === undefined ? undefined : await saver.get(config);
    const start = this._start(input, stored);
    const options: Omit<SessionOptions, "states"> = {
      kinds: this._kinds,
      input: start.input,
      ...(config.signal === undefined ? {} : { signal: config.signal }),
      ...(config.recursionLimit === undefined
        ? {}
        : { recursionLimit: config.recursionLimit }),
      ...(config.tokenLimit === undefined
        ? {}
        : { tokenLimit: config.tokenLimit }),
      ...(config.maxConcurrency === undefined
        ? {}
        : { maxConcurrency: config.maxConcurrency }),
      ...(this._options.interruptBefore === undefined
        ? {}
        : { interruptBefore: this._options.interruptBefore }),
      ...(this._options.interruptAfter === undefined
        ? {}
        : { interruptAfter: this._options.interruptAfter }),
    };
    const session =
      start.trace === undefined
        ? new Session(this._template.copy(), options)
        : resume(start.trace, options);
    let parent = start.parent;
    let saving = Promise.resolve();
    const persist = (): void => {
      if (saver === undefined || thread === undefined) return;
      const checkpoint: Checkpoint = {
        id: crypto.randomUUID(),
        threadId: thread,
        parentId: parent,
        createdAt: new Date().toISOString(),
        input: start.input,
        values: session.values,
        trace: save(session),
      };
      parent = checkpoint.id;
      saving = saving.then(() => saver.put(checkpoint));
    };
    session.signal.on("*", (type, event) => {
      observe(type, event, session);
      if (
        type === "finished" ||
        type === "failed" ||
        type === "skipped" ||
        type === "interrupted"
      ) {
        persist();
      }
    });
    try {
      await run(session);
    } finally {
      persist();
      await saving;
    }
    return valuesOf(session);
  }

  private _start(input: Input, stored: Checkpoint | undefined): Start {
    if (input === null || input instanceof Command) {
      if (stored === undefined) {
        throw new GraphValueError(
          "there is no saved run to continue; pass a thread_id and compile with a checkpointer",
        );
      }
      return {
        input: stored.input,
        trace: {
          graph: stored.trace.graph,
          states: release(stored.trace.states, input),
        },
        parent: stored.id,
      };
    }
    const previous = stored?.values["messages"];
    const next = input["messages"];
    return {
      input:
        Array.isArray(previous) && Array.isArray(next)
          ? { ...input, messages: [...previous, ...next] }
          : input,
      trace: undefined,
      parent: stored?.id,
    };
  }

  private _snapshot(checkpoint: Checkpoint): StateSnapshot {
    const session = resume(checkpoint.trace, {
      kinds: this._kinds,
      input: checkpoint.input,
    });
    const tasks = [...session.states()].map(
      ([id, state]): StateTask => ({
        id,
        name: session.graph.nodeWeight(id)?.kind ?? "",
        status: state.status,
        ...(state.input === undefined ? {} : { input: state.input }),
        ...(state.outputs === undefined ? {} : { result: state.outputs }),
        ...(state.error === undefined ? {} : { error: state.error }),
        interrupts:
          state.status === "interrupted" && state.pending !== undefined
            ? [{ id, value: state.pending.value }]
            : [],
      }),
    );
    const thread = checkpoint.threadId;
    return {
      values: valuesOf(session),
      next: session.next(),
      tasks,
      config: {
        configurable: { thread_id: thread, checkpoint_id: checkpoint.id },
      },
      parentConfig:
        checkpoint.parentId === undefined
          ? undefined
          : {
              configurable: {
                thread_id: thread,
                checkpoint_id: checkpoint.parentId,
              },
            },
      createdAt: checkpoint.createdAt,
    };
  }

  private async _load(config: RunnableConfig): Promise<Checkpoint | undefined> {
    return this._saver(config).get(config);
  }

  private _saver(config: RunnableConfig): Checkpointer {
    const saver = this._options.checkpointer;
    if (saver === undefined) {
      throw new GraphValueError("compile the graph with a checkpointer first");
    }
    if (config.configurable?.thread_id === undefined) {
      throw new GraphValueError("configurable.thread_id is required");
    }
    return saver;
  }
}

function valuesOf(session: Session): StateValues {
  const pending = session.pending();
  if (pending.length === 0) return session.values;
  return {
    ...session.values,
    __interrupt__: pending.map(({ node, value }) => ({ id: node, value })),
  };
}

function release(
  states: Trace["states"],
  command: Command | null,
): Array<readonly [NodeId, State]> {
  const waiting = states
    .filter(
      ([, state]) =>
        state.status === "interrupted" && state.pending?.breakpoint === false,
    )
    .map(([node]) => node);
  const value = command?.resume;
  const keyed =
    command !== null &&
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0 &&
    Object.keys(value).every((key) => waiting.includes(nodeId(key)));
  if (command !== null && !keyed && waiting.length > 1) {
    throw new GraphValueError(
      `${waiting.length} nodes are interrupted; resume them with a map keyed by node id`,
    );
  }
  const resumed = (state: State, resume: unknown): State => ({
    status: "waiting",
    resumes: [...(state.resumes ?? []), resume],
  });
  return states.map(([node, state]): readonly [NodeId, State] => {
    if (state.status !== "interrupted" || state.pending === undefined) {
      return [node, state];
    }
    if (state.pending.breakpoint) return [node, resumed(state, true)];
    if (command === null) return [node, state];
    if (!keyed) return [node, resumed(state, value)];
    const map = value as Readonly<Record<string, unknown>>;
    return node in map ? [node, resumed(state, map[node])] : [node, state];
  });
}

class Channel<T> {
  private readonly _items: T[] = [];
  private _closed = false;
  private _failed = false;
  private _error: unknown;
  private _wake: (() => void) | undefined;

  public push(item: T): void {
    this._items.push(item);
    this._wake?.();
  }

  public close(): void {
    this._closed = true;
    this._wake?.();
  }

  public fail(error: unknown): void {
    this._failed = true;
    this._error = error;
    this._wake?.();
  }

  public async *drain(): AsyncGenerator<T, void, undefined> {
    for (;;) {
      while (this._items.length > 0) yield this._items.shift() as T;
      if (this._failed) throw this._error;
      if (this._closed) return;
      await new Promise<void>((resolve) => {
        this._wake = resolve;
      });
      this._wake = undefined;
    }
  }
}

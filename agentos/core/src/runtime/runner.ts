import { run as drive, type Graph, type NodeId } from "@openconsole/graph";

import {
  Execution,
  extend,
  type Cache,
  type Events,
  type State,
} from "../engine";
import {
  lookup,
  RuntimeError,
  type Limits,
  type Operator,
  type Plan,
  type Policy,
  type Registry,
  type Usage,
  type Values,
  type Weight,
} from "../graph";
import { MemoryStore, type Store } from "../storage";
import type { Pending, Resume, Run, RunEvent, RunOptions } from "./run";

export interface Blueprint {
  readonly template: Graph<Weight>;
  readonly operators: Registry;
}

export interface RunnerOptions {
  readonly name: string;
  readonly description?: string;
  readonly store?: Store;
  readonly limits?: Limits;
  readonly policy?: Policy;
}

type Entry =
  | { readonly by: NodeId; readonly plan: Plan }
  | { readonly node: NodeId; readonly state: State };

interface Start {
  readonly key: string;
  readonly run: Run;
  readonly execution: Execution;
  readonly sequence: number;
}

interface Restored {
  readonly graph: Graph<Weight>;
  readonly states: Map<NodeId, State>;
  readonly sequence: number;
}

interface Nested {
  readonly [NESTED]: Runner;
}

const RUNS = "runs";

let clock = 0;
const STEPS = "steps";

const CACHE = "cache";

const LEASE = 30_000;

const NESTED = Symbol("nested");

export abstract class Runner {
  public readonly name: string;
  public readonly description: string;
  public readonly store: Store;
  public readonly policy: Policy;
  private readonly _limits: Limits;
  private readonly _cache: Cache;

  protected constructor(options: RunnerOptions) {
    this.name = options.name;
    this.description = options.description ?? options.name;
    this.store = options.store ?? new MemoryStore();
    this.policy = options.policy ?? {};
    this._limits = options.limits ?? {};
    this._cache = {
      get: (key) => this.store.get(CACHE, key),
      put: (key, value) => this.store.put(CACHE, key, value),
    };
  }

  public async run(
    input: Values | Resume,
    options: RunOptions = {},
  ): Promise<Run> {
    let last: Run | undefined;
    for await (const event of this.stream(input, options)) {
      if (event.type === "end") last = event.run;
    }
    if (last === undefined) {
      throw new RuntimeError("run", `${this.name} ended without a run`);
    }
    return last;
  }

  public stream(
    input: Values | Resume,
    options: RunOptions = {},
  ): AsyncGenerator<RunEvent, void, undefined> {
    const channel = new Channel<RunEvent>();
    this._execute(input, options, (event) => channel.push(event)).then(
      (run) => {
        channel.push({ type: "end", run });
        channel.close();
      },
      (error: unknown) => channel.fail(error),
    );
    return channel.drain();
  }

  public async runs(session: string): Promise<Run[]> {
    const records = await this.store.list(RUNS, `${session}/`);
    return records.map(([, record]) => record as Run);
  }

  protected abstract blueprint(): Promise<Blueprint>;

  protected async opened(_run: Run): Promise<void> {}

  protected async closed(_run: Run): Promise<void> {}

  private async _execute(
    input: Values | Resume,
    options: RunOptions,
    emit: (event: RunEvent) => void,
  ): Promise<Run> {
    const { template, operators } = await this.blueprint();
    const limits = { ...this._limits, ...options.limits };
    const start = resumes(input)
      ? await this._resume(input, options, template, operators, limits)
      : this._begin(input, options, template, operators, limits);
    const { execution, key } = start;
    let run: Run = { ...start.run, status: "running", updated: now() };
    let sequence = start.sequence;
    let saving = this.store.put(RUNS, key, run);
    const log = (entry: Entry): void => {
      const key = step(run.id, sequence++);
      saving = saving.then(() => this.store.put(STEPS, key, entry));
    };
    const failures: Array<Events["fail"]> = [];
    execution.signal.on("*", (type, event) => {
      emit({ type, ...event } as RunEvent);
      if (type === "grow") {
        const { by, plan } = event as Events["grow"];
        log({ by, plan });
        return;
      }
      if (type === "fail") failures.push(event as Events["fail"]);
      if (
        type === "finish" ||
        type === "fail" ||
        type === "skip" ||
        type === "pause"
      ) {
        const { node } = event as { readonly node: NodeId };
        const state = execution.state(node);
        if (state !== undefined) log({ node, state });
      }
    });
    await this.opened(run);
    const beat = setInterval(() => {
      saving = saving.then(() =>
        this.store.put(RUNS, key, { ...run, updated: now() }),
      );
    }, LEASE / 3);
    let error: unknown;
    try {
      await drive(execution);
    } catch (cause) {
      error = cause;
    }
    clearInterval(beat);
    const failure = failures.find(
      ({ node }) => execution.graph.outDegree(node) === 0,
    );
    if (error === undefined && failure !== undefined) error = failure.cause;
    const pending = execution.pending().flatMap(({ node, value }): Pending[] =>
      nested(operators, execution.graph, node, value) === undefined
        ? [{ id: node, value }]
        : (value as readonly Pending[]).map((item) => ({
            id: `${node}:${item.id}`,
            value: item.value,
          })),
    );
    run = {
      ...run,
      status:
        error !== undefined
          ? "failed"
          : pending.length > 0
            ? "paused"
            : "completed",
      output: execution.values,
      pending,
      usage: total(execution),
      updated: now(),
      error:
        error === undefined
          ? undefined
          : error instanceof Error
            ? error.message
            : String(error),
    };
    saving = saving.then(() => this.store.put(RUNS, key, run));
    await saving;
    await this.closed(run);
    if (error !== undefined) throw error;
    return run;
  }

  private _begin(
    input: Values,
    options: RunOptions,
    template: Graph<Weight>,
    operators: Registry,
    limits: Limits,
  ): Start {
    const id = crypto.randomUUID();
    const session = options.session ?? crypto.randomUUID();
    clock = Math.max(Date.now(), clock + 1);
    const created = new Date(clock).toISOString();
    const run: Run = {
      id,
      session,
      ...(options.user === undefined ? {} : { user: options.user }),
      status: "running",
      input,
      output: {},
      pending: [],
      usage: { input: 0, output: 0 },
      created,
      updated: created,
    };
    const execution = new Execution(template.copy(), {
      operators,
      input,
      limits,
      policy: this.policy,
      cache: this._cache,
      scope: { run: id, session, user: options.user },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    return { key: `${session}/${created}/${id}`, run, execution, sequence: 0 };
  }

  private async _resume(
    input: Resume,
    options: RunOptions,
    template: Graph<Weight>,
    operators: Registry,
    limits: Limits,
  ): Promise<Start> {
    const session = options.session;
    if (session === undefined) {
      throw new RuntimeError("resume", "pass the session of the run to resume");
    }
    const last = (await this.store.list(RUNS, `${session}/`)).at(-1);
    const record = last?.[1] as Run | undefined;
    if (
      last === undefined ||
      record === undefined ||
      record.status === "completed"
    ) {
      throw new RuntimeError(
        "resume",
        `session ${session} has no run to resume`,
      );
    }
    if (
      record.status === "running" &&
      Date.now() - Date.parse(record.updated) < LEASE
    ) {
      throw new RuntimeError("resume", `run ${record.id} is still running`);
    }
    const restored = await this._restore(record, template, operators);
    const sequence = await this._answer(
      record,
      restored,
      operators,
      input.resume,
    );
    const { graph, states } = restored;
    for (const [node, state] of states) {
      if (state.status === "failed" && graph.outDegree(node) === 0) {
        states.set(node, { status: "waiting" });
      }
    }
    const execution = new Execution(graph, {
      operators,
      input: record.input,
      limits,
      policy: this.policy,
      cache: this._cache,
      states,
      scope: { run: record.id, session, user: record.user },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    return { key: last[0], run: record, execution, sequence };
  }

  private async _restore(
    record: Run,
    template: Graph<Weight>,
    operators: Registry,
  ): Promise<Restored> {
    const graph = template.copy();
    const states = new Map<NodeId, State>();
    const steps = await this.store.list(STEPS, `${record.id}/`);
    const entries = steps.map(([, value]) => value as Entry);
    for (const entry of entries) {
      if ("state" in entry) states.set(entry.node, entry.state);
    }
    for (const entry of entries) {
      if ("plan" in entry && states.has(entry.by) && graph.hasNode(entry.by)) {
        extend(graph, entry.plan, operators, entry.by);
      }
    }
    for (const node of states.keys()) {
      if (!graph.hasNode(node)) states.delete(node);
    }
    return { graph, states, sequence: steps.length };
  }

  private async _answer(
    record: Run,
    restored: Restored,
    operators: Registry,
    answers: Readonly<Record<string, unknown>>,
  ): Promise<number> {
    let sequence = restored.sequence;
    for (const [node, state] of restored.states) {
      if (state.status !== "paused") continue;
      const child = nested(operators, restored.graph, node, state.pending);
      let woken: State | undefined;
      if (child === undefined) {
        woken =
          node in answers
            ? {
                status: "waiting",
                resumes: [...(state.resumes ?? []), answers[node]],
              }
            : undefined;
      } else if (
        await child._delegate(`${record.id}:${node}`, branch(answers, node))
      ) {
        woken =
          state.resumes === undefined
            ? { status: "waiting" }
            : { status: "waiting", resumes: state.resumes };
      }
      if (woken === undefined) continue;
      restored.states.set(node, woken);
      await this.store.put(STEPS, step(record.id, sequence++), {
        node,
        state: woken,
      });
    }
    return sequence;
  }

  private async _delegate(
    session: string,
    answers: Readonly<Record<string, unknown>>,
  ): Promise<boolean> {
    if (Object.keys(answers).length === 0) return false;
    const record = (await this.store.list(RUNS, `${session}/`)).at(-1)?.[1] as
      | Run
      | undefined;
    if (record?.status !== "paused") return false;
    const { template, operators } = await this.blueprint();
    const restored = await this._restore(record, template, operators);
    const sequence = await this._answer(record, restored, operators, answers);
    return sequence > restored.sequence;
  }
}

export function nest(runner: Runner): Operator {
  const operator: Operator & Nested = {
    [NESTED]: runner,
    name: runner.name,
    description: runner.description,
    inputSchema: {
      type: "object",
      properties: { task: { type: "string" } },
      required: ["task"],
    },
    outputSchema: { type: "object", properties: { result: {} } },
    run: async (input, context) => {
      const session = `${context.scope.run}:${context.node}`;
      const options: RunOptions = {
        session,
        signal: context.signal,
        ...(context.scope.user === undefined
          ? {}
          : { user: context.scope.user }),
      };
      const follow = async (source: Values | Resume): Promise<Run> => {
        let last: Run | undefined;
        for await (const event of runner.stream(source, options)) {
          if (event.type === "delta") context.emit(event.text);
          else if (event.type === "usage") context.spend(event.usage);
          else if (event.type === "end") last = event.run;
        }
        if (last === undefined) {
          throw new RuntimeError("nest", `${runner.name} ended without a run`);
        }
        return last;
      };
      const previous = (await runner.runs(session)).at(-1);
      let run =
        previous === undefined
          ? await follow(input)
          : previous.status === "completed"
            ? previous
            : await follow({ resume: {} });
      while (run.status === "paused") {
        context.interrupt(run.pending);
        run = await follow({ resume: {} });
      }
      return { result: run.output["answer"] ?? run.output };
    },
  };
  return operator;
}

function nested(
  operators: Registry,
  graph: Graph<Weight>,
  node: NodeId,
  pending: unknown,
): Runner | undefined {
  if (!Array.isArray(pending)) return undefined;
  const operator = lookup(operators, graph.nodeWeight(node)?.operator ?? "");
  const runner =
    operator !== undefined && NESTED in operator ? operator[NESTED] : undefined;
  return runner instanceof Runner ? runner : undefined;
}

function branch(
  answers: Readonly<Record<string, unknown>>,
  node: NodeId,
): Record<string, unknown> {
  const prefix = `${node}:`;
  return Object.fromEntries(
    Object.entries(answers)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key.slice(prefix.length), value]),
  );
}

function step(run: string, sequence: number): string {
  return `${run}/${String(sequence).padStart(8, "0")}`;
}

function resumes(input: Values | Resume): input is Resume {
  const value = (input as { readonly resume?: unknown }).resume;
  return typeof value === "object" && value !== null;
}

function total(execution: Execution): Usage {
  let input = 0;
  let output = 0;
  for (const [, state] of execution.states()) {
    input += state.usage?.input ?? 0;
    output += state.usage?.output ?? 0;
  }
  return { input, output };
}

function now(): string {
  return new Date().toISOString();
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

import {
  Future,
  Interrupted,
  type Graph,
  type NodeId,
} from "@openconsole/graph";
import { Signal } from "@openconsole/signal";

import {
  check,
  gathers,
  GraphInterrupt,
  GraphRecursionError,
  InvalidUpdateError,
  lookup,
  portsOf,
  properties,
  TokenLimitError,
  ValidationError,
  type Context,
  type Kind,
  type Plan,
  type Registry,
  type Usage,
  type Values,
  type Weight,
} from "../common";

export type Status =
  | "waiting"
  | "running"
  | "done"
  | "failed"
  | "skipped"
  | "interrupted";

export interface Pending {
  readonly value: unknown;
  readonly breakpoint: boolean;
}

export interface State {
  readonly status: Status;
  readonly input?: Values;
  readonly outputs?: Values;
  readonly error?: string;
  readonly started?: number;
  readonly ended?: number;
  readonly usage?: Usage;
  readonly resumes?: readonly unknown[];
  readonly pending?: Pending;
}

export interface SessionOptions {
  readonly kinds: Registry;
  readonly input?: Values;
  readonly recursionLimit?: number;
  readonly tokenLimit?: number;
  readonly maxConcurrency?: number;
  readonly interruptBefore?: readonly string[];
  readonly interruptAfter?: readonly string[];
  readonly signal?: AbortSignal;
  readonly states?: Iterable<readonly [NodeId, State]>;
}

export interface SessionEvents {
  started: { readonly node: NodeId };
  finished: { readonly node: NodeId; readonly outputs: Values };
  failed: { readonly node: NodeId; readonly error: string };
  skipped: { readonly node: NodeId };
  interrupted: {
    readonly node: NodeId;
    readonly value: unknown;
    readonly breakpoint: boolean;
  };
  grown: { readonly by: NodeId; readonly nodes: readonly NodeId[] };
  delta: { readonly node: NodeId; readonly text: string };
  custom: { readonly node: NodeId; readonly chunk: unknown };
  spent: { readonly node: NodeId; readonly usage: Usage };
}

export const RECURSION_LIMIT = 100;

const ANSWER = "answer";

interface Lane {
  readonly order: number;
  readonly value: unknown;
  readonly present: boolean;
  readonly array: boolean;
}

const settled = (status: Status | undefined): boolean =>
  status === "done" || status === "failed" || status === "skipped";

const reset = (state: State): State =>
  state.resumes === undefined
    ? { status: "waiting" }
    : { status: "waiting", resumes: state.resumes };

export class Session extends Future<Values> {
  public readonly signal = new Signal<SessionEvents>({
    rescue: (error) => {
      queueMicrotask(() => {
        throw error;
      });
    },
  });

  private readonly _states = new Map<NodeId, State>();
  private readonly _flights = new Map<NodeId, Promise<void>>();
  private _control = new AbortController();
  private _wake: () => void = () => {};
  private _values: Values = {};
  private _latest = -Infinity;
  private _spent = 0;
  private _peak = 0;
  private _paused = false;

  public constructor(
    public readonly graph: Graph<Weight>,
    private readonly _options: SessionOptions,
  ) {
    super();
    const restored = new Map(_options.states);
    for (const node of graph.nodes()) {
      const state: State = restored.get(node) ?? { status: "waiting" };
      this._states.set(node, state.status === "running" ? reset(state) : state);
      this._spent += (state.usage?.input ?? 0) + (state.usage?.output ?? 0);
      this._consider(node, state);
    }
    _options.signal?.addEventListener("abort", () => this.cancel(), {
      once: true,
    });
  }

  public get spent(): number {
    return this._spent;
  }

  public get values(): Values {
    return this._values;
  }

  public state(node: NodeId): State | undefined {
    return this._states.get(node);
  }

  public states(): Iterable<readonly [NodeId, State]> {
    return this._states.entries();
  }

  public next(): NodeId[] {
    const next: NodeId[] = [];
    for (const [node, state] of this._states) {
      const runnable = state.status === "waiting" && this._ready(node);
      if (runnable || state.status === "interrupted") next.push(node);
    }
    return next;
  }

  public pending(): Array<{ readonly node: NodeId } & Pending> {
    const found: Array<{ readonly node: NodeId } & Pending> = [];
    for (const [node, state] of this._states) {
      if (state.status === "interrupted" && state.pending !== undefined) {
        found.push({ node, ...state.pending });
      }
    }
    return found;
  }

  public cancel(): void {
    this._control.abort();
    this._wake();
  }

  public result(): Values {
    this.ensure();
    return this._values;
  }

  protected async step(): Promise<boolean> {
    if (this._control.signal.aborted) return this._interrupt();
    if (!this._paused) {
      const limit = this._options.maxConcurrency ?? Infinity;
      for (const [node, state] of this._states) {
        if (this._flights.size >= limit) break;
        if (
          state.status === "waiting" &&
          !this._flights.has(node) &&
          this._ready(node)
        ) {
          this._launch(node);
        }
      }
    }
    if (this._flights.size === 0) return false;
    await new Promise<void>((resolve) => {
      this._wake = resolve;
    });
    if (this._control.signal.aborted) return this._interrupt();
    return true;
  }

  protected measure(): number {
    let finished = 0;
    for (const state of this._states.values()) {
      if (settled(state.status)) finished++;
    }
    let ratio = this.ratio(finished, this._states.size);
    const tokens = this._options.tokenLimit;
    if (tokens !== undefined) ratio = Math.max(ratio, this._spent / tokens);
    this._peak = Math.min(0.99, Math.max(this._peak, ratio));
    return this._peak;
  }

  private async _interrupt(): Promise<never> {
    await Promise.allSettled(this._flights.values());
    this._control = new AbortController();
    throw new Interrupted(this.progress);
  }

  private _ready(node: NodeId): boolean {
    let ready = true;
    this.graph.forEachIn(node, (source) => {
      ready = settled(this._states.get(source)?.status);
      return ready;
    });
    return ready;
  }

  private _limit(): number {
    return this._options.recursionLimit ?? RECURSION_LIMIT;
  }

  private _matches(
    list: readonly string[] | undefined,
    node: NodeId,
    kind: Kind,
  ): boolean {
    return (
      list !== undefined && (list.includes(node) || list.includes(kind.name))
    );
  }

  private _launch(node: NodeId): void {
    const flight = this._execute(node).finally(() => {
      this._flights.delete(node);
      this._wake();
    });
    this._flights.set(node, flight);
  }

  private async _execute(node: NodeId): Promise<void> {
    const resumes = this._states.get(node)?.resumes ?? [];
    let input: Values | undefined;
    let started: number | undefined;
    try {
      const weight = this.graph.nodeWeight(node);
      const kind =
        weight === undefined
          ? undefined
          : lookup(this._options.kinds, weight.kind);
      if (weight === undefined || kind === undefined) {
        throw new Error(`${node} has an unknown kind ${weight?.kind ?? ""}`);
      }
      input = this._gather(node, kind, weight);
      if (input === undefined) {
        this._states.set(node, { status: "skipped", ended: Date.now() });
        this.signal.emit("skipped", { node });
        return;
      }
      const problems = check(kind.inputSchema, input);
      if (problems.length > 0) {
        throw new ValidationError(`input of ${node}`, problems);
      }
      const breakpoint = this._matches(
        this._options.interruptBefore,
        node,
        kind,
      );
      if (breakpoint && resumes.length === 0) {
        this._suspend(node, input, resumes, {
          value: { node, kind: kind.name },
          breakpoint: true,
        });
        return;
      }
      started = Date.now();
      this._states.set(node, {
        status: "running",
        input,
        started,
        ...(resumes.length === 0 ? {} : { resumes }),
      });
      this.signal.emit("started", { node });
      const outputs = await kind.run(
        input,
        this._context(node, resumes, breakpoint ? 1 : 0),
      );
      const invalid = check(kind.outputSchema, outputs);
      if (invalid.length > 0)
        throw new ValidationError(`output of ${node}`, invalid);
      const usage = this._states.get(node)?.usage;
      const done: State = {
        status: "done",
        input,
        outputs,
        started,
        ended: Date.now(),
        ...(usage === undefined ? {} : { usage }),
      };
      this._states.set(node, done);
      this._consider(node, done);
      this.signal.emit("finished", { node, outputs });
      if (this._matches(this._options.interruptAfter, node, kind)) {
        this._paused = true;
      }
    } catch (error) {
      if (error instanceof GraphInterrupt && input !== undefined) {
        this._suspend(node, input, resumes, {
          value: error.value,
          breakpoint: false,
        });
        return;
      }
      if (started !== undefined && this._control.signal.aborted) {
        this._states.set(
          node,
          resumes.length === 0
            ? { status: "waiting" }
            : { status: "waiting", resumes },
        );
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this._fail(node, message, input, started);
    }
  }

  private _suspend(
    node: NodeId,
    input: Values,
    resumes: readonly unknown[],
    pending: { readonly value: unknown; readonly breakpoint: boolean },
  ): void {
    const usage = this._states.get(node)?.usage;
    this._states.set(node, {
      status: "interrupted",
      input,
      pending,
      ...(resumes.length === 0 ? {} : { resumes }),
      ...(usage === undefined ? {} : { usage }),
    });
    this.signal.emit("interrupted", { node, ...pending });
  }

  private _consider(node: NodeId, state: State): void {
    if (state.status !== "done" || state.outputs === undefined) return;
    const name = this.graph.nodeWeight(node)?.kind ?? "";
    const kind = lookup(this._options.kinds, name);
    if (kind === undefined || !(ANSWER in properties(kind.outputSchema)))
      return;
    const ended = state.ended ?? 0;
    if (ended < this._latest) return;
    this._latest = ended;
    this._values = state.outputs;
  }

  private _gather(
    node: NodeId,
    kind: Kind,
    weight: Weight,
  ): Values | undefined {
    const declared = properties(kind.inputSchema);
    const input: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(this._options.input ?? {})) {
      if (name in declared) input[name] = value;
    }
    Object.assign(input, weight.values);
    const lanes = new Map<string, Lane[]>();
    this.graph.forEachIn(node, (source, edge, port) => {
      const list = lanes.get(port) ?? [];
      list.push(this._lane(source, this.graph.edge(edge)?.sourcePort ?? ""));
      lanes.set(port, list);
    });
    for (const [port, list] of lanes) {
      list.sort((a, b) => a.order - b.order);
      if (gathers(kind.inputSchema, port)) {
        const only = list.length === 1 ? list[0] : undefined;
        input[port] =
          only !== undefined &&
          only.present &&
          only.array &&
          Array.isArray(only.value)
            ? only.value
            : list.filter((lane) => lane.present).map((lane) => lane.value);
        continue;
      }
      const lane = list[0];
      if (lane === undefined || !lane.present) return undefined;
      input[port] = lane.value;
    }
    return input;
  }

  private _lane(source: NodeId, port: string): Lane {
    const order = this.graph.indexOf(source);
    const state = this._states.get(source);
    if (state?.status === "failed") {
      return {
        order,
        value: { error: state.error },
        present: true,
        array: false,
      };
    }
    const value = state?.status === "done" ? state.outputs?.[port] : undefined;
    if (value === undefined) {
      return { order, value, present: false, array: false };
    }
    const producer = lookup(
      this._options.kinds,
      this.graph.nodeWeight(source)?.kind ?? "",
    );
    return {
      order,
      value,
      present: true,
      array: producer !== undefined && gathers(producer.outputSchema, port),
    };
  }

  private _context(
    node: NodeId,
    resumes: readonly unknown[],
    offset: number,
  ): Context {
    let cursor = offset;
    const remaining = (): number => this._limit() - this.graph.order;
    return {
      node,
      parent: this.graph.parent(node),
      input: this._options.input ?? {},
      signal: this._control.signal,
      get remaining() {
        return remaining();
      },
      spend: (usage) => {
        this._spend(node, usage);
      },
      emit: (text) => {
        this.signal.emit("delta", { node, text });
      },
      writer: (chunk) => {
        this.signal.emit("custom", { node, chunk });
      },
      interrupt: (value) => {
        if (cursor < resumes.length) return resumes[cursor++];
        throw new GraphInterrupt(value);
      },
      grow: (plan) => this._grow(node, plan),
    };
  }

  private _spend(node: NodeId, usage: Usage): void {
    this._spent += usage.input + usage.output;
    const state = this._states.get(node);
    if (state !== undefined) {
      this._states.set(node, {
        ...state,
        usage: {
          input: (state.usage?.input ?? 0) + usage.input,
          output: (state.usage?.output ?? 0) + usage.output,
        },
      });
    }
    this.signal.emit("spent", { node, usage });
  }

  private _fail(
    node: NodeId,
    error: string,
    input?: Values,
    started?: number,
  ): void {
    const usage = this._states.get(node)?.usage;
    this._states.set(node, {
      status: "failed",
      error,
      ended: Date.now(),
      ...(input === undefined ? {} : { input }),
      ...(started === undefined ? {} : { started }),
      ...(usage === undefined ? {} : { usage }),
    });
    this.signal.emit("failed", { node, error });
  }

  private _grow(by: NodeId, plan: Plan): NodeId[] {
    const kinds = this._options.kinds;
    if (lookup(kinds, this.graph.nodeWeight(by)?.kind ?? "")?.plans !== true) {
      throw new InvalidUpdateError(`${by} cannot plan`);
    }
    const limit = this._limit();
    if (this.graph.order + plan.steps.length > limit) {
      throw new GraphRecursionError(limit);
    }
    const tokens = this._options.tokenLimit;
    if (tokens !== undefined && this._spent >= tokens) {
      throw new TokenLimitError(tokens);
    }

    const fresh = new Map<NodeId, readonly [number, Kind]>();
    plan.steps.forEach((step, position) => {
      if (this.graph.hasNode(step.id) || fresh.has(step.id)) {
        throw new InvalidUpdateError(`node ${step.id} already exists`);
      }
      const kind = lookup(kinds, step.kind);
      if (kind === undefined) {
        throw new InvalidUpdateError(`unknown kind ${step.kind}`);
      }
      fresh.set(step.id, [position, kind]);
    });
    for (const step of plan.steps) {
      const parent = step.parent;
      if (
        parent !== undefined &&
        parent !== null &&
        !this.graph.hasNode(parent) &&
        !fresh.has(parent)
      ) {
        throw new InvalidUpdateError(`unknown parent ${parent}`);
      }
    }

    const taken = new Set<string>();
    for (const {
      from: [source, out],
      to: [target, port],
    } of plan.edges ?? []) {
      const entry = fresh.get(target);
      if (entry === undefined) {
        throw new InvalidUpdateError(
          `edges may only enter new nodes, not ${target}`,
        );
      }
      const [position, kind] = entry;
      const origin = fresh.get(source);
      if (
        origin === undefined
          ? !this.graph.hasNode(source)
          : origin[0] >= position
      ) {
        throw new InvalidUpdateError(
          `${source} must exist or come before ${target}`,
        );
      }
      const producer =
        origin?.[1] ?? lookup(kinds, this.graph.nodeWeight(source)?.kind ?? "");
      const output =
        producer === undefined
          ? undefined
          : portsOf(producer.outputSchema, "output")[out];
      const input = portsOf(kind.inputSchema, "input")[port];
      if (output === undefined) {
        throw new InvalidUpdateError(`${source} has no output ${out}`);
      }
      if (input === undefined) {
        throw new InvalidUpdateError(`${target} has no input ${port}`);
      }
      if (!output.socket.accepts(input.socket)) {
        throw new InvalidUpdateError(
          `${source}.${out} does not fit ${target}.${port}`,
        );
      }
      const slot = `${target}\u0000${port}`;
      if (!input.multiple && taken.has(slot)) {
        throw new InvalidUpdateError(`${target}.${port} takes a single edge`);
      }
      taken.add(slot);
    }

    this.graph.batch(() => {
      for (const step of plan.steps) {
        const kind = fresh.get(step.id)?.[1];
        if (kind === undefined) continue;
        this.graph.addNode({
          id: step.id,
          weight: { kind: step.kind, values: step.values ?? {} },
          inputs: portsOf(kind.inputSchema, "input"),
          outputs: portsOf(kind.outputSchema, "output"),
        });
        this._states.set(step.id, { status: "waiting" });
      }
      for (const step of plan.steps) {
        const parent = step.parent === undefined ? by : step.parent;
        if (parent !== null) this.graph.setParent(step.id, parent);
      }
      for (const edge of plan.edges ?? [])
        this.graph.connect(edge.from, edge.to);
    });
    const nodes = plan.steps.map((step) => step.id);
    this.signal.emit("grown", { by, nodes });
    this._wake();
    return nodes;
  }
}

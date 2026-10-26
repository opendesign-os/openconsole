import {
  Future,
  Interrupted,
  type Graph,
  type NodeId,
} from "@openconsole/graph";
import { Signal } from "@openconsole/signal";

import {
  check,
  DefinitionError,
  gathers,
  LimitError,
  lookup,
  Pause,
  PlanError,
  ports,
  properties,
  TimeoutError,
  ValidationError,
  type Context,
  type Limits,
  type Operator,
  type Plan,
  type Policy,
  type Registry,
  type Scope,
  type Usage,
  type Values,
  type Weight,
} from "../graph";
import { fingerprint, type Cache, type Memo } from "./cache";

export type Status =
  | "waiting"
  | "running"
  | "done"
  | "failed"
  | "skipped"
  | "paused";

export interface State {
  readonly status: Status;
  readonly input?: Values;
  readonly outputs?: Values;
  readonly error?: string;
  readonly started?: number;
  readonly ended?: number;
  readonly usage?: Usage;
  readonly resumes?: readonly unknown[];
  readonly pending?: unknown;
}

export interface ExecutionOptions {
  readonly operators: Registry;
  readonly scope: Scope;
  readonly input?: Values;
  readonly limits?: Limits;
  readonly policy?: Policy;
  readonly cache?: Cache;
  readonly signal?: AbortSignal;
  readonly states?: Iterable<readonly [NodeId, State]>;
}

export interface Events {
  start: { readonly node: NodeId; readonly operator: string };
  finish: {
    readonly node: NodeId;
    readonly outputs: Values;
    readonly cached?: boolean;
  };
  fail: {
    readonly node: NodeId;
    readonly error: string;
    readonly cause: unknown;
  };
  retry: {
    readonly node: NodeId;
    readonly attempt: number;
    readonly error: string;
  };
  skip: { readonly node: NodeId };
  pause: { readonly node: NodeId; readonly value: unknown };
  grow: { readonly by: NodeId; readonly plan: Plan };
  delta: { readonly node: NodeId; readonly text: string };
  data: { readonly node: NodeId; readonly data: unknown };
  usage: { readonly node: NodeId; readonly usage: Usage };
}

const NODES = 100;

const DELAY = 1_000;

const FACTOR = 2;

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

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const retryable = (error: unknown, policy: Policy): boolean =>
  !(
    error instanceof Pause ||
    error instanceof LimitError ||
    error instanceof DefinitionError
  ) &&
  (policy.retry?.(error) ?? true);

const wait = (delay: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, delay);
    signal.addEventListener("abort", done, { once: true });
  });

export function extend(
  graph: Graph<Weight>,
  plan: Plan,
  operators: Registry,
  by: NodeId,
): void {
  graph.batch(() => {
    for (const step of plan.steps) {
      const operator = lookup(operators, step.operator);
      if (operator === undefined)
        throw new PlanError(`unknown operator ${step.operator}`);
      graph.addNode({
        id: step.id,
        weight: { operator: step.operator, values: step.values ?? {} },
        inputs: ports(operator.inputSchema, "input"),
        outputs: ports(operator.outputSchema, "output"),
      });
    }
    for (const step of plan.steps) {
      const parent = step.parent === undefined ? by : step.parent;
      if (parent !== null) graph.setParent(step.id, parent);
    }
    for (const edge of plan.edges ?? []) graph.connect(edge.from, edge.to);
  });
}

export class Execution extends Future<Values> {
  public readonly signal = new Signal<Events>({
    rescue: (error) => {
      queueMicrotask(() => {
        throw error;
      });
    },
  });

  private readonly _states = new Map<NodeId, State>();
  private readonly _flights = new Map<NodeId, Promise<void>>();
  private readonly _planned = new Set<NodeId>();
  private _control = new AbortController();
  private _wake: () => void = () => {};
  private _values: Values = {};
  private _latest = -Infinity;
  private _spent = 0;
  private _peak = 0;

  public constructor(
    public readonly graph: Graph<Weight>,
    private readonly _options: ExecutionOptions,
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

  public pending(): Array<{ readonly node: NodeId; readonly value: unknown }> {
    const found: Array<{ readonly node: NodeId; readonly value: unknown }> = [];
    for (const [node, state] of this._states) {
      if (state.status === "paused") found.push({ node, value: state.pending });
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
    const limit = this._options.limits?.concurrency ?? Infinity;
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
    const tokens = this._options.limits?.tokens;
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
    return this._options.limits?.nodes ?? NODES;
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
      const operator =
        weight === undefined
          ? undefined
          : lookup(this._options.operators, weight.operator);
      if (weight === undefined || operator === undefined) {
        throw new Error(
          `${node} has an unknown operator ${weight?.operator ?? ""}`,
        );
      }
      input = this._gather(node, operator, weight);
      if (input === undefined) {
        this._states.set(node, { status: "skipped", ended: Date.now() });
        this.signal.emit("skip", { node });
        return;
      }
      started = Date.now();
      this._states.set(node, {
        status: "running",
        input,
        started,
        ...(resumes.length === 0 ? {} : { resumes }),
      });
      this.signal.emit("start", { node, operator: operator.name });
      const cache = resumes.length === 0 ? this._cache(operator) : undefined;
      const cached =
        cache === undefined
          ? undefined
          : await this._recall(cache, operator, input);
      const outputs =
        cached ?? (await this._settle(node, operator, input, resumes));
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
      this.signal.emit(
        "finish",
        cached === undefined
          ? { node, outputs }
          : { node, outputs, cached: true },
      );
    } catch (error) {
      if (error instanceof Pause && input !== undefined) {
        this._suspend(node, input, resumes, error.value);
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
      this._fail(node, error, input, started);
    }
  }

  private async _settle(
    node: NodeId,
    operator: Operator,
    input: Values,
    resumes: readonly unknown[],
  ): Promise<Values> {
    let outputs: Values;
    try {
      const problems = check(operator.inputSchema, input);
      if (problems.length > 0) {
        throw new ValidationError(`input of ${node}`, problems);
      }
      outputs = await this._retry(node, operator, input, resumes);
    } catch (error) {
      if (
        operator.recover === undefined ||
        error instanceof Pause ||
        this._control.signal.aborted
      ) {
        throw error;
      }
      const context = this._context(node, resumes, this._control.signal);
      return this._check(
        node,
        operator,
        await operator.recover(error, input, context),
      );
    }
    if (resumes.length === 0) await this._remember(operator, input, outputs);
    return outputs;
  }

  private _policy(operator: Operator): Policy {
    return { ...this._options.policy, ...operator.policy };
  }

  private _cache(operator: Operator): Cache | undefined {
    return this._policy(operator).cache === undefined || operator.plans === true
      ? undefined
      : this._options.cache;
  }

  private async _recall(
    cache: Cache,
    operator: Operator,
    input: Values,
  ): Promise<Values | undefined> {
    const memo = (await cache.get(await fingerprint(operator.name, input))) as
      | Memo
      | undefined;
    const ttl = this._policy(operator).cache ?? 0;
    if (memo === undefined || Date.now() - memo.created > ttl) return undefined;
    return check(operator.outputSchema, memo.outputs).length === 0
      ? memo.outputs
      : undefined;
  }

  private async _remember(
    operator: Operator,
    input: Values,
    outputs: Values,
  ): Promise<void> {
    const cache = this._cache(operator);
    if (cache === undefined) return;
    const memo: Memo = { outputs, created: Date.now() };
    await cache.put(await fingerprint(operator.name, input), memo);
  }

  private async _retry(
    node: NodeId,
    operator: Operator,
    input: Values,
    resumes: readonly unknown[],
  ): Promise<Values> {
    const policy = this._policy(operator);
    const attempts = policy.attempts ?? 1;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this._attempt(
          node,
          operator,
          input,
          resumes,
          policy.timeout,
        );
      } catch (error) {
        const signal = this._control.signal;
        if (
          attempt >= attempts ||
          signal.aborted ||
          this._planned.has(node) ||
          !retryable(error, policy)
        ) {
          throw error;
        }
        this.signal.emit("retry", { node, attempt, error: message(error) });
        await wait(
          (policy.delay ?? DELAY) * (policy.factor ?? FACTOR) ** (attempt - 1),
          signal,
        );
        if (signal.aborted) throw error;
      }
    }
  }

  private async _attempt(
    node: NodeId,
    operator: Operator,
    input: Values,
    resumes: readonly unknown[],
    timeout: number | undefined,
  ): Promise<Values> {
    this._control.signal.throwIfAborted();
    const control = new AbortController();
    const context = this._context(
      node,
      resumes,
      AbortSignal.any([this._control.signal, control.signal]),
    );
    const work = operator
      .run(input, context)
      .then((outputs) => this._check(node, operator, outputs));
    if (timeout === undefined) return work;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new TimeoutError(timeout);
        control.abort(error);
        reject(error);
      }, timeout);
    });
    try {
      return await Promise.race([work, expiry]);
    } finally {
      clearTimeout(timer);
    }
  }

  private _check(node: NodeId, operator: Operator, outputs: Values): Values {
    const problems = check(operator.outputSchema, outputs);
    if (problems.length > 0) {
      throw new ValidationError(`output of ${node}`, problems);
    }
    return outputs;
  }

  private _suspend(
    node: NodeId,
    input: Values,
    resumes: readonly unknown[],
    value: unknown,
  ): void {
    const usage = this._states.get(node)?.usage;
    this._states.set(node, {
      status: "paused",
      input,
      pending: value,
      ...(resumes.length === 0 ? {} : { resumes }),
      ...(usage === undefined ? {} : { usage }),
    });
    this.signal.emit("pause", { node, value });
  }

  private _consider(node: NodeId, state: State): void {
    if (state.status !== "done" || state.outputs === undefined) return;
    const name = this.graph.nodeWeight(node)?.operator ?? "";
    const operator = lookup(this._options.operators, name);
    if (
      operator === undefined ||
      !(ANSWER in properties(operator.outputSchema))
    ) {
      return;
    }
    const ended = state.ended ?? 0;
    if (ended < this._latest) return;
    this._latest = ended;
    this._values = state.outputs;
  }

  private _gather(
    node: NodeId,
    operator: Operator,
    weight: Weight,
  ): Values | undefined {
    const declared = properties(operator.inputSchema);
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
      if (gathers(operator.inputSchema, port)) {
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
      this._options.operators,
      this.graph.nodeWeight(source)?.operator ?? "",
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
    signal: AbortSignal,
  ): Context {
    let cursor = 0;
    const remaining = (): number => this._limit() - this.graph.order;
    return {
      node,
      parent: this.graph.parent(node),
      scope: this._options.scope,
      input: this._options.input ?? {},
      signal,
      get remaining() {
        return remaining();
      },
      spend: (usage) => {
        this._spend(node, usage);
      },
      emit: (text) => {
        this.signal.emit("delta", { node, text });
      },
      publish: (data) => {
        this.signal.emit("data", { node, data });
      },
      interrupt: (value) => {
        if (cursor < resumes.length) return resumes[cursor++];
        throw new Pause(value);
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
    this.signal.emit("usage", { node, usage });
  }

  private _fail(
    node: NodeId,
    cause: unknown,
    input?: Values,
    started?: number,
  ): void {
    const error = message(cause);
    const usage = this._states.get(node)?.usage;
    this._states.set(node, {
      status: "failed",
      error,
      ended: Date.now(),
      ...(input === undefined ? {} : { input }),
      ...(started === undefined ? {} : { started }),
      ...(usage === undefined ? {} : { usage }),
    });
    this.signal.emit("fail", { node, error, cause });
  }

  private _grow(by: NodeId, plan: Plan): NodeId[] {
    const operators = this._options.operators;
    if (
      lookup(operators, this.graph.nodeWeight(by)?.operator ?? "")?.plans !==
      true
    ) {
      throw new PlanError(`${by} cannot plan`);
    }
    const limit = this._limit();
    if (this.graph.order + plan.steps.length > limit) {
      throw new LimitError("nodes", limit);
    }
    const tokens = this._options.limits?.tokens;
    if (tokens !== undefined && this._spent >= tokens) {
      throw new LimitError("tokens", tokens);
    }

    const fresh = new Map<NodeId, readonly [number, Operator]>();
    plan.steps.forEach((step, position) => {
      if (this.graph.hasNode(step.id) || fresh.has(step.id)) {
        throw new PlanError(`node ${step.id} already exists`);
      }
      const operator = lookup(operators, step.operator);
      if (operator === undefined) {
        throw new PlanError(`unknown operator ${step.operator}`);
      }
      fresh.set(step.id, [position, operator]);
    });
    for (const step of plan.steps) {
      const parent = step.parent;
      if (
        parent !== undefined &&
        parent !== null &&
        !this.graph.hasNode(parent) &&
        !fresh.has(parent)
      ) {
        throw new PlanError(`unknown parent ${parent}`);
      }
    }

    const taken = new Set<string>();
    for (const {
      from: [source, out],
      to: [target, port],
    } of plan.edges ?? []) {
      const entry = fresh.get(target);
      if (entry === undefined) {
        throw new PlanError(`edges may only enter new nodes, not ${target}`);
      }
      const [position, operator] = entry;
      const origin = fresh.get(source);
      if (
        origin === undefined
          ? !this.graph.hasNode(source)
          : origin[0] >= position
      ) {
        throw new PlanError(`${source} must exist or come before ${target}`);
      }
      const producer =
        origin?.[1] ??
        lookup(operators, this.graph.nodeWeight(source)?.operator ?? "");
      const output =
        producer === undefined
          ? undefined
          : ports(producer.outputSchema, "output")[out];
      const input = ports(operator.inputSchema, "input")[port];
      if (output === undefined) {
        throw new PlanError(`${source} has no output ${out}`);
      }
      if (input === undefined) {
        throw new PlanError(`${target} has no input ${port}`);
      }
      if (!output.socket.accepts(input.socket)) {
        throw new PlanError(`${source}.${out} does not fit ${target}.${port}`);
      }
      const slot = `${target}\u0000${port}`;
      if (!input.multiple && taken.has(slot)) {
        throw new PlanError(`${target}.${port} takes a single edge`);
      }
      taken.add(slot);
    }

    extend(this.graph, plan, operators, by);
    this._planned.add(by);
    const nodes = plan.steps.map((step) => step.id);
    for (const node of nodes) this._states.set(node, { status: "waiting" });
    this.signal.emit("grow", { by, plan });
    this._wake();
    return nodes;
  }
}

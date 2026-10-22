import type { Patch, State } from "./state";
import type { Store } from "./store";

export interface CapabilityOptions {
  readonly signal?: AbortSignal;
}

export interface Unit {
  readonly active: boolean;
  destroy(): void;
}

export type Part<U extends Unit = Unit> = U | (() => void);

export abstract class Capability<
  N,
  O extends CapabilityOptions,
  U extends Unit = Unit,
> {
  readonly node: N;
  protected options: O;
  #units: readonly U[] = [];
  #cleanups: readonly (() => void)[] = [];
  readonly #lifetime = new AbortController();

  constructor(node: N, options: O) {
    this.node = node;
    this.options = options;
    const { signal } = options;
    if (signal?.aborted) this.#lifetime.abort();
    signal?.addEventListener("abort", () => this.destroy(), {
      once: true,
      signal: this.#lifetime.signal,
    });
  }

  get active(): boolean {
    return this.#units.some((unit) => unit.active);
  }

  update(options: Partial<O>): this {
    if (this.#lifetime.signal.aborted) return this;
    this.options = { ...this.options, ...options };
    return this.apply(options) ? this : this.refresh();
  }

  refresh(): this {
    if (this.#lifetime.signal.aborted) return this;
    this.#release();
    const parts = this.build();
    this.#units = parts.filter((part) => typeof part !== "function");
    this.#cleanups = parts.filter((part) => typeof part === "function");
    return this;
  }

  destroy(): void {
    if (this.#lifetime.signal.aborted) return;
    this.#lifetime.abort();
    this.#release();
  }

  [Symbol.dispose](): void {
    this.destroy();
  }

  protected get units(): readonly U[] {
    return this.#units;
  }

  protected abstract build(): readonly Part<U>[];

  protected apply(changes: Partial<O>): boolean {
    return Object.keys(changes).length === 0;
  }

  #release(): void {
    for (const unit of this.#units) unit.destroy();
    for (const cleanup of this.#cleanups) cleanup();
    this.#units = [];
    this.#cleanups = [];
  }
}

export abstract class Shape<
  N,
  O extends CapabilityOptions,
  U extends Unit = Unit,
> extends Capability<N, O, U> {
  readonly #store: Store;

  constructor(node: N, store: Store, options: O) {
    super(node, options);
    this.#store = store;
  }

  get state(): State {
    return this.#store.state;
  }

  assign(patch: Patch): this {
    this.#store.assign(patch);
    return this;
  }
}

/**
 * @file 能力的基类约定：生命周期、单元与清理，以及操作节点几何的 {@link Shape}。
 *
 * 基类属于模型层，不引用 DOM；`N` 为节点类型，DOM 侧传入 `HTMLElement`。
 * 子类只实现 `build()`，按当前选项创建单元与清理函数，其余生命周期由基类负责。
 */

import type { Patch, State } from "./state";
import type { Store } from "./store";

/** 所有能力共有的选项。 */
export interface CapabilityOptions {
  /** 中止时自动调用 `destroy()`；创建时已中止则能力不会生效。 */
  readonly signal?: AbortSignal;
}

/** 能力创建的可销毁单元，例如 `bind` 返回的 `Binding`。 */
export interface Unit {
  /** 是否有会话正在进行。 */
  readonly active: boolean;
  /** 销毁单元，释放它持有的监听与状态；进行中的会话随之结束。 */
  destroy(): void;
}

/**
 * `build()` 的产物：单元，或在重建与销毁时调用的清理函数。
 *
 * @template U 单元类型。
 */
export type Part<U extends Unit = Unit> = U | (() => void);

/**
 * 能力的基类：持有节点与选项，管理 `build()` 产出的单元与清理函数。
 *
 * `refresh()` 先释放旧产物再按当前选项重建；`update()` 先交给 `apply()` 就地应用，
 * 不行再重建；`destroy()` 之后所有方法都不再生效。
 *
 * @template N 节点类型。
 * @template O 选项类型。
 * @template U 单元类型，默认 {@link Unit}。
 * @example
 * class Logger extends Capability<HTMLElement, CapabilityOptions> {
 *   constructor(node: HTMLElement, options: CapabilityOptions = {}) {
 *     super(node, options);
 *     this.refresh();
 *   }
 *
 *   protected build(): readonly Part[] {
 *     const log = () => console.log("down");
 *     this.node.addEventListener("pointerdown", log);
 *     return [() => this.node.removeEventListener("pointerdown", log)];
 *   }
 * }
 */
export abstract class Capability<
  N,
  O extends CapabilityOptions,
  U extends Unit = Unit,
> {
  /** 能力所在的节点。 */
  readonly node: N;
  /** 当前选项；`update()` 合并写入。 */
  protected options: O;
  #units: readonly U[] = [];
  #cleanups: readonly (() => void)[] = [];
  /** 能力的生命期：中止即已销毁，同时用来摘除对 `options.signal` 的监听。 */
  readonly #lifetime = new AbortController();

  /**
   * 子类初始化完自身字段后应调用 `refresh()`：基类构造时子类字段尚未初始化，不能在这里构建。
   *
   * @param node 能力所在的节点。
   * @param options 初始选项。
   */
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

  /** 是否有任一单元的会话正在进行。 */
  get active(): boolean {
    return this.#units.some((unit) => unit.active);
  }

  /**
   * 合并写入传入的选项，未传入的保持不变。
   *
   * 先交给 `apply()` 就地应用；`apply()` 返回 `false` 时按当前选项重建。已销毁时不做任何事。
   *
   * @param options 要修改的选项。
   * @returns 能力本身，便于链式调用。
   */
  update(options: Partial<O>): this {
    if (this.#lifetime.signal.aborted) return this;
    this.options = { ...this.options, ...options };
    return this.apply(options) ? this : this.refresh();
  }

  /**
   * 释放当前单元与清理函数，再按当前选项重新构建；例如增删了子元素之后调用。
   *
   * @returns 能力本身，便于链式调用。
   */
  refresh(): this {
    if (this.#lifetime.signal.aborted) return this;
    this.#release();
    const parts = this.build();
    this.#units = parts.filter((part) => typeof part !== "function");
    this.#cleanups = parts.filter((part) => typeof part === "function");
    return this;
  }

  /** 销毁能力：释放所有单元与清理函数，可重复调用。 */
  destroy(): void {
    if (this.#lifetime.signal.aborted) return;
    this.#lifetime.abort();
    this.#release();
  }

  /** 同 `destroy()`，支持 `using` 声明。 */
  [Symbol.dispose](): void {
    this.destroy();
  }

  /** 当前单元，供子类就地更新时遍历。 */
  protected get units(): readonly U[] {
    return this.#units;
  }

  /**
   * 按当前选项创建单元与清理函数；每次 `refresh()` 调用一次。
   *
   * @returns 本能力的单元与清理函数。
   */
  protected abstract build(): readonly Part<U>[];

  /**
   * 就地应用变化的选项，返回 `false` 表示需要按当前选项重建。
   *
   * 默认只在没有任何变化时返回 `true`；子类覆写时只对改变结构的选项返回 `false`。
   *
   * @param changes 本次传入 `update()` 的选项。
   * @returns 是否已就地应用。
   */
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

/**
 * 改变节点几何的能力的基类：在 {@link Capability} 之上暴露节点共享的状态。
 *
 * 同一节点上的多项能力共用一个 {@link Store}，任何一项提交都会同步给其他能力。
 *
 * @template N 节点类型。
 * @template O 选项类型。
 * @template U 单元类型，默认 {@link Unit}。
 * @example
 * const drag = new Draggable(card);
 * drag.assign({ matrix: plane.translate(120, 80) });
 * drag.state.matrix; // [1, 0, 0, 1, 120, 80]
 */
export abstract class Shape<
  N,
  O extends CapabilityOptions,
  U extends Unit = Unit,
> extends Capability<N, O, U> {
  readonly #store: Store;

  /**
   * @param node 能力所在的节点。
   * @param store 节点共享的状态存储；DOM 侧为 `View.of(node).store`。
   * @param options 初始选项。
   */
  constructor(node: N, store: Store, options: O) {
    super(node, options);
    this.#store = store;
  }

  /** 节点当前状态，矩阵把局部空间映射到容器空间。 */
  get state(): State {
    return this.#store.state;
  }

  /**
   * 写入状态；会话进行中不生效。选项只放配置，状态只经这里写入，重建不会改变状态。
   *
   * @param patch 要写入的矩阵、尺寸或序号。
   * @returns 能力本身，便于链式调用。
   */
  assign(patch: Patch): this {
    this.#store.assign(patch);
    return this;
  }
}

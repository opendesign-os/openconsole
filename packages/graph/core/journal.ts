/**
 * 事务化的变更账本：版本计数、事件缓冲、嵌套事务、派发隔离。
 *
 * @remarks 这四件事一条邻接数组都不碰，因此单独成层——与它同处一个类时，"图存了什么"
 *   和"图怎么把变更说出去"会互相遮挡，而后者的重入与错误隔离恰恰是最需要单独盯住的部分。
 *   这里只认一张事件映射表，不认识图。
 *
 * @packageDocumentation
 */

import { Signal, type EventType } from "@openconsole/signal";

/** 事务边界事件的名字；事件表必须声明它。 */
const BOUNDARY = "flushed";

/**
 * 变更波及的范围，决定推进哪些版本计数器。编译产物按范围分别作废，改一处不必重算全部。
 *
 * - `shape` 结构变了（增删节点与边、改端口、改层级、压缩）——CSR 与两条权重数组全部作废
 * - `weight` 只有边权变了——CSR 与点权数组仍可原样复用
 * - `cost` 只有点权变了——CSR 与边权数组仍可原样复用
 */
export type Scope = "shape" | "weight" | "cost";

/**
 * 一段可嵌套事务里的变更与事件。
 *
 * 变更点调 {@link Journal.mark} 登记——它顺带回答"这个事件有人听吗"，回答"没有"时调用方
 * 连载荷都不构造。{@link Journal.commit} 在事务外立刻派发，在 {@link Journal.batch} 内
 * 则攒到最外层结束。
 */
export class Journal<E extends object & { flushed: { changes: number } }> {
  /**
   * 变更事件总线。
   *
   * @remarks 装了 `rescue`：某个 handler 抛错时**其余 handler 与其余事件照常派发**，
   *   错误收集起来、本轮派发完再上抛（多个错误聚合为 `AggregateError`）。少了这层隔离，
   *   一个坏订阅者会连带掐掉同一事务里其他订阅者的事件——那些事件已从队列里摘走，
   *   补不回来，按索引维护增量状态的订阅者从此静默错位。
   */
  public readonly signal = new Signal<E>({
    rescue: (error) => {
      this._failures.push(error);
    },
  });

  private _revision = 0;
  private _shape = 0;
  private _weights = 0;
  private _costs = 0;
  private _depth = 0;
  private _changes = 0;
  private _settling = false;
  /** 本轮派发里各 handler 抛出的错误，见 {@link Journal.signal}。 */
  private readonly _failures: unknown[] = [];
  /** 待派发事件，`[类型, 载荷, 类型, 载荷, ...]` 交错存放，免去每条事件一个闭包。 */
  private readonly _queue: unknown[] = [];

  /** 任意变更都会推进。 */
  public get revision(): number {
    return this._revision;
  }

  /** 只有 `shape` 范围的变更才推进。 */
  public get shape(): number {
    return this._shape;
  }

  /** 边权可能变了；`shape` 范围的变更一并推进它，因此单看它就够判断边权数组是否作废。 */
  public get weights(): number {
    return this._weights;
  }

  /** 点权可能变了，语义同 {@link Journal.weights}。 */
  public get costs(): number {
    return this._costs;
  }

  /**
   * 登记一次变更，并回答「这个事件有人听吗」。每个变更点恰好调一次。
   *
   * @remarks 返回 `false` 时调用方连载荷对象都不构造，于是无人订阅的变更热路径零分配。
   *   批量导入几万条变更时，这决定了事务里是空的还是堆着几万个载荷。
   *
   *   漏调不会报错，但版本号停在旧值，据它判断"没变"的缓存会静默过期。
   */
  public mark<K extends EventType<E>>(type: K, scope: Scope): boolean {
    this._revision++;
    if (scope !== "cost") this._weights++;
    if (scope !== "weight") this._costs++;
    if (scope === "shape") this._shape++;
    this._changes++;
    return this._heard(type);
  }

  /** 把载荷排进本次事务；只在 {@link Journal.mark} 答"有人听"后调用。 */
  public push<K extends EventType<E>>(type: K, payload: E[K]): void {
    this._queue.push(type, payload);
  }

  /**
   * 事务：期间的事件缓冲到最外层结束时统一派发，随后放一次 `flushed`；抛错也照常派发
   * 已积累的事件。
   */
  public batch<T>(work: () => T): T {
    this._depth++;
    try {
      return work();
    } finally {
      this._depth--;
      if (this._depth === 0) this._settle();
    }
  }

  /** 单次变更自成一段事务：不在 {@link Journal.batch} 里就立刻派发。 */
  public commit(): void {
    if (this._depth === 0) this._settle();
  }

  /** 这个事件有人听吗。 */
  private _heard(type: EventType<E>): boolean {
    // 一个订阅者都没有是批量导入的常态，先用两次属性读挡掉，别去查按键分桶的表。
    const signal = this.signal;
    if (!signal.has()) return false;
    return signal.has(type) || signal.has("*");
  }

  /**
   * 事务收尾：按序放出缓冲的事件，再放一次 `flushed`。
   *
   * @remarks handler 里继续改图是常态（比如布局据此插节点）。那些变更会照常排进同一个
   *   队列，由这里接着收——重入的 `_settle` 直接返回，不另起一轮。否则内层会把外层的
   *   计数抢走并提前放出 `flushed`，外层剩下的事件反而排在事务边界之后。
   *
   *   handler 抛错不打断派发（`rescue` 兜住），但错误会在队列排空后上抛：订阅者之间
   *   互不牵连，调用方也不会以为一切正常。
   */
  private _settle(): void {
    if (this._settling) return;
    this._settling = true;
    try {
      const queue = this._queue;
      const signal = this.signal;
      while (queue.length > 0 || this._changes > 0) {
        while (queue.length > 0) {
          // 先摘下来再派发：handler 改图时不会与本轮迭代抢同一个数组。
          const queued = queue.splice(0, queue.length);
          for (let i = 0; i < queued.length; i += 2) {
            signal.emit(queued[i] as EventType<E>, queued[i + 1] as never);
          }
        }
        const changes = this._changes;
        this._changes = 0;
        const boundary = BOUNDARY as EventType<E>;
        if (changes > 0 && this._heard(boundary)) {
          signal.emit(boundary, { changes } as never);
        }
      }
    } finally {
      this._settling = false;
    }
    if (this._failures.length > 0) {
      const failures = this._failures.splice(0, this._failures.length);
      if (failures.length === 1) throw failures[0];
      throw new AggregateError(failures, `${failures.length} handlers failed`);
    }
  }
}

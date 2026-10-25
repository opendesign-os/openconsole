import { BucketQueue, LazyQueue, type IndexQueue } from "@openconsole/queue";

import { backtrack, type Reals } from "../array";
import { Cycle, Invalid, Negative } from "../error";
import {
  afford,
  CEILING,
  weights,
  profileOf,
  reversed,
  type DenseOptions,
  type Structure,
} from "../structure";
import { Stepwise, type Task } from "../task";

/**
 * 路径代价的合成方式。Dijkstra 的贪心要求 `combine(total, step) >= total`，
 * 满足这一点的语义都能复用同一份实现，无需另写算法。
 */
export type Combine = (total: number, step: number) => number;

/** 常规最短路：代价累加。 */
export const sum: Combine = (total, step) => total + step;

/** 瓶颈路径：代价取路径上最重的一段，求"最大边权最小"的路线。 */
export const bottleneck: Combine = (total, step) =>
  step > total ? step : total;

/** 最短路径树，下标即节点索引。 */
export interface Tree {
  /** 不可达为 `Infinity`。 */
  readonly distance: Float64Array;
  /** 前驱节点索引，无前驱为 -1。 */
  readonly parent: Int32Array;
}

export interface Route {
  readonly distance: number;
  /** 路径上的节点索引，从起点到终点。 */
  readonly path: Int32Array;
}

export interface PathOptions {
  combine?: Combine;
}

export interface AstarOptions extends PathOptions {
  /** 到终点的剩余代价估计；不高估真实代价时结果最优。省略即退化成 Dijkstra。 */
  heuristic?: (node: number) => number;
}

/** 桶队列的最大边权上限：路径总长随它增长，空桶扫描是 O(总长) 的实打实开销。 */
const BUCKETS = 1 << 8;

/**
 * 逐边现取边权并校验。提前终止型的搜索走这条路而不是 {@link weights} 的一次性预扫——
 * 它们只探索一小片图，预扫全部边权往往比实际访问到的边还多。
 *
 * @throws {@link Invalid} `NaN` 权边
 * @throws {@link Negative} 负权边
 */
function verified(weight: Reals | undefined, e: number): number {
  const cost = weight === undefined ? 1 : weight[e]!;
  if (Number.isNaN(cost)) throw new Invalid(e);
  if (cost < 0) throw new Negative(cost, e);
  return cost;
}

/**
 * 挑选优先队列，顺手校验负权。非负整数权且内置 combine 保证增量有界时用桶队列
 * （O(1) 出入队），否则用惰性堆。两者给出的距离一致，只影响耗时。
 *
 * @throws {@link Negative} 存在负权边——Dijkstra 的贪心不成立，改用 {@link bellmanFord}
 */
function pick(structure: Structure, combine: Combine): IndexQueue {
  const { integral, max, negative } = profileOf(structure);
  if (negative >= 0) {
    throw new Negative(structure.weight![negative]!, negative);
  }
  // 自定义 combine 可能把优先级推出桶窗口，只有内置两种才走桶队列。
  const bounded = combine === sum || combine === bottleneck;
  // 空桶扫描要靠出入队的量摊薄，稀疏图摊不动，反而比堆慢。
  const dense = structure.size >= 2 * structure.order;
  return integral && bounded && dense && max <= BUCKETS
    ? new BucketQueue(structure.order, max)
    : new LazyQueue(structure.order);
}

/**
 * Dijkstra：全程整数下标 + typed-array，优先队列不做 decrease-key——改善即入队，
 * 靠 `closed` 位图跳过过期条目。
 */
class Dijkstra extends Stepwise<Tree> {
  public readonly distance: Float64Array;
  public readonly parent: Int32Array;
  private readonly _closed: Uint8Array;
  /** 首步才建：挑队列要先扫一遍边权画像，摆在构造函数里就成了不可中断的 O(E)。 */
  private _queue: IndexQueue | undefined;
  private readonly _source: number;
  private readonly _weight: Reals | undefined;
  /** 默认语义是加法；据此特化内层循环，省掉每条边一次的间接调用。 */
  private readonly _adding: boolean;
  private _reached = 0;

  public constructor(
    private readonly _structure: Structure,
    source: number,
    private readonly _combine: Combine,
  ) {
    super();
    this.distance = new Float64Array(_structure.order).fill(Infinity);
    this.parent = new Int32Array(_structure.order).fill(-1);
    this._closed = new Uint8Array(_structure.order);
    this._source = source;
    this._weight = _structure.weight;
    this._adding = _combine === sum;
  }

  protected measure(): number {
    return this.ratio(this._reached, this._structure.order);
  }

  private _open(): IndexQueue {
    const queue = pick(this._structure, this._combine);
    const source = this._source;
    if (source >= 0 && source < this._structure.order) {
      this.distance[source] = 0;
      queue.push(source, 0);
    }
    return queue;
  }

  protected step(): boolean {
    const queue = (this._queue ??= this._open());
    const u = queue.poll();
    if (u === -1) return false;
    if (this._closed[u] === 1) return true;
    this._closed[u] = 1;
    this._reached++;

    const { offset, other, edge } = this._structure.outbound;
    const weight = this._weight;
    const base = this.distance[u]!;
    for (let k = offset[u]!; k < offset[u + 1]!; k++) {
      const v = other[k]!;
      if (this._closed[v] === 1) continue;
      const cost = weight === undefined ? 1 : weight[edge[k]!]!;
      const candidate = this._adding ? base + cost : this._combine(base, cost);
      if (candidate < this.distance[v]!) {
        this.distance[v] = candidate;
        this.parent[v] = u;
        queue.push(v, candidate);
      }
    }
    return true;
  }

  public result(): Tree {
    this.ensure();
    return { distance: this.distance, parent: this.parent };
  }
}

/**
 * 单源最短路径树，覆盖所有可达节点。
 *
 * @throws {@link Negative} 存在负权边——负权用 {@link bellmanFord}
 */
export const shortestPaths = (
  structure: Structure,
  source: number,
  options: PathOptions = {},
): Task<Tree> => new Dijkstra(structure, source, options.combine ?? sum);

/** 沿前驱链重建路径；目标越界或不可达返回空数组。 */
export function trace(tree: Tree, target: number): Int32Array {
  // 越界必须在这里挡住：`parent[越界]` 是 undefined，往下走会变成不终止的回溯。
  if (target < 0 || target >= tree.parent.length) return new Int32Array(0);
  if (tree.distance[target] === Infinity) return new Int32Array(0);
  return backtrack(tree.parent, target);
}

/** A\*：以 `g + h` 为优先级。`heuristic` 不高估真实剩余代价时结果最优。 */
class AStar extends Stepwise<Route | undefined> {
  private readonly _score: Float64Array;
  private readonly _parent: Int32Array;
  private readonly _closed: Uint8Array;
  private readonly _queue: LazyQueue;
  private readonly _weight: Reals | undefined;
  private readonly _adding: boolean;
  private _reached = 0;
  private _found = false;

  public constructor(
    private readonly _structure: Structure,
    source: number,
    private readonly _target: number,
    private readonly _heuristic: (node: number) => number,
    private readonly _combine: Combine,
  ) {
    super();
    this._queue = new LazyQueue(_structure.order);
    this._score = new Float64Array(_structure.order).fill(Infinity);
    this._parent = new Int32Array(_structure.order).fill(-1);
    this._closed = new Uint8Array(_structure.order);
    this._weight = _structure.weight;
    this._adding = _combine === sum;

    const inside = (u: number): boolean => u >= 0 && u < _structure.order;
    if (inside(source) && inside(_target)) {
      this._score[source] = 0;
      this._queue.push(source, _heuristic(source));
    }
  }

  protected measure(): number {
    return this.ratio(this._reached, this._structure.order);
  }

  protected step(): boolean {
    const u = this._queue.poll();
    if (u === -1) return false;
    // 终点首次出队即最优：f = g + h(target) 里 h 是常量。
    if (u === this._target) {
      this._found = true;
      return false;
    }
    if (this._closed[u] === 1) return true;
    this._closed[u] = 1;
    this._reached++;

    const { offset, other, edge } = this._structure.outbound;
    const weight = this._weight;
    const base = this._score[u]!;
    for (let k = offset[u]!; k < offset[u + 1]!; k++) {
      const v = other[k]!;
      if (this._closed[v] === 1) continue;
      const cost = verified(weight, edge[k]!);
      const candidate = this._adding ? base + cost : this._combine(base, cost);
      if (candidate >= this._score[v]!) continue;
      this._score[v] = candidate;
      this._parent[v] = u;
      this._queue.push(v, candidate + this._heuristic(v));
    }
    return true;
  }

  public result(): Route | undefined {
    this.ensure();
    if (!this._found) return undefined;
    const tree: Tree = { distance: this._score, parent: this._parent };
    return {
      distance: this._score[this._target]!,
      path: trace(tree, this._target),
    };
  }
}

const blind = (): number => 0;

export const astar = (
  structure: Structure,
  source: number,
  target: number,
  options: AstarOptions = {},
): Task<Route | undefined> =>
  new AStar(
    structure,
    source,
    target,
    options.heuristic ?? blind,
    options.combine ?? sum,
  );

/**
 * 单条最短路。摸到终点即停，因此**只**给出这一条路线——不返回路径树，
 * 避免把提前终止时尚未收敛的距离误当最短值使用。
 *
 * @remarks 就是不带启发式的 {@link astar}，因此与它共用同一套提前终止的机器：
 *   逐边现取现验，而不是入口处预扫一遍全部边权。点对点查询只探索一小片图，
 *   预扫往往比实际访问到的边还多——那正是 {@link shortestPaths} 才划算的事。
 */
export const shortestPath = (
  structure: Structure,
  source: number,
  target: number,
  options: PathOptions = {},
): Task<Route | undefined> =>
  new AStar(structure, source, target, blind, options.combine ?? sum);

interface Side {
  readonly distance: Float64Array;
  readonly parent: Int32Array;
  readonly settled: Uint8Array;
  readonly queue: LazyQueue;
  /** 队列里可信的最小距离；惰性队列堆顶可能过期，故单独维护。 */
  frontier: number;
}

const flank = (order: number, source: number): Side => {
  const side: Side = {
    distance: new Float64Array(order).fill(Infinity),
    parent: new Int32Array(order).fill(-1),
    settled: new Uint8Array(order),
    queue: new LazyQueue(order),
    frontier: 0,
  };
  if (source >= 0 && source < order) {
    side.distance[source] = 0;
    side.queue.push(source, 0);
  }
  return side;
};

/**
 * 双向 Dijkstra：两侧交替扩展，`forward.frontier + backward.frontier >= best` 时停止。
 *
 * @remarks 终止条件要比较两侧前沿之和，而惰性队列的堆顶可能是过期条目。这里不引入
 *   decrease-key，而是把"已出队的最小距离"记在 {@link Side.frontier} 上——它单调
 *   非减且必然可信，同样能安全地作为终止判据。
 */
class Bidirectional extends Stepwise<Route | undefined> {
  private readonly _forward: Side;
  private readonly _backward: Side;
  private readonly _reverse: Structure;
  private readonly _weight: Reals | undefined;
  private _best = Infinity;
  private _meet = -1;
  private _reached = 0;

  public constructor(
    private readonly _structure: Structure,
    private readonly _source: number,
    private readonly _target: number,
  ) {
    super();
    this._reverse = reversed(_structure);
    this._weight = _structure.weight;
    this._forward = flank(_structure.order, _source);
    this._backward = flank(_structure.order, _target);
    if (_source >= 0 && _source < _structure.order && _source === _target) {
      this._best = 0;
      this._meet = _source;
    }
  }

  protected measure(): number {
    return this.ratio(this._reached, 2 * this._structure.order);
  }

  protected step(): boolean {
    const order = this._structure.order;
    if (this._source < 0 || this._target < 0) return false;
    if (this._source >= order || this._target >= order) return false;
    if (this._meet === this._source && this._best === 0) return false;
    if (this._forward.queue.empty() || this._backward.queue.empty())
      return false;
    if (this._forward.frontier + this._backward.frontier >= this._best)
      return false;

    const outward = this._forward.frontier <= this._backward.frontier;
    const near = outward ? this._forward : this._backward;
    const far = outward ? this._backward : this._forward;
    const view = outward ? this._structure : this._reverse;

    const u = near.queue.poll();
    if (u === -1) return false;
    if (near.settled[u] === 1) return true;
    near.settled[u] = 1;
    near.frontier = near.distance[u]!;
    this._reached++;
    this._link(u, near, far);

    const { offset, other, edge } = view.outbound;
    const weight = this._weight;
    const base = near.distance[u]!;
    for (let k = offset[u]!; k < offset[u + 1]!; k++) {
      const v = other[k]!;
      if (near.settled[v] === 1) continue;
      const candidate = base + verified(weight, edge[k]!);
      if (candidate < near.distance[v]!) {
        near.distance[v] = candidate;
        near.parent[v] = u;
        near.queue.push(v, candidate);
        this._link(v, near, far);
      }
    }
    return true;
  }

  private _link(u: number, near: Side, far: Side): void {
    const total = near.distance[u]! + far.distance[u]!;
    if (total < this._best) {
      this._best = total;
      this._meet = u;
    }
  }

  public result(): Route | undefined {
    this.ensure();
    if (this._meet === -1 || this._best === Infinity) return undefined;
    // 两侧都从相遇点回溯：前半段本就是 起点→相遇点，后半段回溯出 终点→相遇点，
    // 翻转即得 相遇点→终点，去掉重复的相遇点后拼接。
    const ahead = backtrack(this._forward.parent, this._meet);
    const behind = backtrack(this._backward.parent, this._meet).reverse();
    const path = new Int32Array(ahead.length + behind.length - 1);
    path.set(ahead);
    path.set(behind.subarray(1), ahead.length);
    return { distance: this._best, path };
  }
}

export const bidirectional = (
  structure: Structure,
  source: number,
  target: number,
): Task<Route | undefined> => new Bidirectional(structure, source, target);

/** Bellman-Ford：容许负权，每步松弛一个节点的出边。 */
class BellmanFord extends Stepwise<Tree> {
  private readonly _distance: Float64Array;
  private readonly _parent: Int32Array;
  private readonly _weight: Reals | undefined;
  private _round = 0;
  private _cursor = 0;
  /** 本轮是否有过改善；一整轮无改善即收敛。 */
  private _changed = false;
  /** 最后一个被松弛的节点，负环归因从它回溯。 */
  private _last = -1;

  public constructor(
    private readonly _structure: Structure,
    source: number,
  ) {
    super();
    this._distance = new Float64Array(_structure.order).fill(Infinity);
    this._parent = new Int32Array(_structure.order).fill(-1);
    this._weight = weights(_structure);
    if (source >= 0 && source < _structure.order) this._distance[source] = 0;
  }

  protected measure(): number {
    const n = this._structure.order;
    return this.ratio(this._round * n + this._cursor, n * n);
  }

  /**
   * 一步 = 一轮松弛里的一个节点，O(deg)。
   *
   * @remarks 一整轮是 O(E)；在稠密图上那已经比其他算法的单步粗一个数量级，分帧时会
   *   卡出可见的掉帧。轮次边界单独占一步，收敛判定与负环判定都落在那里。
   */
  protected step(): boolean {
    const n = this._structure.order;
    if (this._round >= n) return false;

    if (this._cursor >= n) {
      this._round++;
      this._cursor = 0;
      const changed = this._changed;
      this._changed = false;
      // 第 order 轮仍有改善 ⇒ 存在从起点可达的负环。
      if (changed && this._round === n) throw new Cycle(this._blame());
      return changed;
    }

    const u = this._cursor++;
    const base = this._distance[u]!;
    if (base === Infinity) return true;

    const { offset, other, edge } = this._structure.outbound;
    const weight = this._weight;
    for (let k = offset[u]!; k < offset[u + 1]!; k++) {
      const v = other[k]!;
      const candidate = base + (weight === undefined ? 1 : weight[edge[k]!]!);
      if (candidate < this._distance[v]!) {
        this._distance[v] = candidate;
        this._parent[v] = u;
        this._changed = true;
        this._last = v;
      }
    }
    return true;
  }

  /** 从最后被松弛的节点沿前驱链走 order 步必然落在环上，再绕一圈即得环成员。 */
  private _blame(): number[] {
    let cursor = this._last;
    for (let i = 0; i < this._structure.order; i++) {
      const next = this._parent[cursor]!;
      if (next === -1) break;
      cursor = next;
    }
    const cycle: number[] = [cursor];
    for (
      let walk = this._parent[cursor]!;
      walk !== -1 && walk !== cursor;
      walk = this._parent[walk]!
    ) {
      cycle.push(walk);
    }
    return cycle.reverse();
  }

  public result(): Tree {
    this.ensure();
    return { distance: this._distance, parent: this._parent };
  }
}

/**
 * 单源最短路，容许负权。
 *
 * @throws {@link Cycle} 从起点可达负权环
 */
export const bellmanFord = (structure: Structure, source: number): Task<Tree> =>
  new BellmanFord(structure, source);

/** 全源最短距离矩阵，行优先扁平存储。 */
export class Matrix {
  public constructor(
    public readonly order: number,
    public readonly cells: Float64Array,
  ) {}

  /** 不可达为 `Infinity`；越界为 `NaN`。 */
  public at(from: number, to: number): number {
    if (from < 0 || to < 0 || from >= this.order || to >= this.order) {
      return NaN;
    }
    return this.cells[from * this.order + to]!;
  }
}

/** Floyd-Warshall：先逐行铺底（每步一个节点），再每步推进一个中转节点的一行。 */
class FloydWarshall extends Stepwise<Matrix> {
  private readonly _cells: Float64Array;
  private readonly _weight: Reals | undefined;
  private _primed = 0;
  private _through = 0;
  private _row = 0;

  public constructor(
    private readonly _structure: Structure,
    limit: number,
  ) {
    super();
    const n = _structure.order;
    afford(8 * n * n, limit, `floydWarshall on V=${n}`);
    this._cells = new Float64Array(n * n);
    this._weight = weights(_structure);
  }

  protected measure(): number {
    const n = this._structure.order;
    return this.ratio(this._primed + this._through * n + this._row, n + n * n);
  }

  private _prime(u: number): void {
    const n = this._structure.order;
    const row = u * n;
    this._cells.fill(Infinity, row, row + n);
    this._cells[row + u] = 0;

    const { offset, other, edge } = this._structure.outbound;
    const weight = this._weight;
    for (let k = offset[u]!; k < offset[u + 1]!; k++) {
      const cell = row + other[k]!;
      const cost = weight === undefined ? 1 : weight[edge[k]!]!;
      if (cost < this._cells[cell]!) this._cells[cell] = cost;
    }
  }

  /**
   * 一步 = 一个中转节点的一行，O(V)。
   *
   * @remarks 整个矩阵是 O(V³)，一步吃掉一个完整的中转节点就是 O(V²)——V=5000 时单步
   *   要几十毫秒，`schedule` 的一帧预算再小也让不出去。粒度必须细到与其他算法可比。
   *   铺底同理：整块 fill 加播种是 O(V²+E)，拆成每步一行才进得了预算。
   */
  protected step(): boolean {
    const n = this._structure.order;
    if (this._primed < n) {
      this._prime(this._primed++);
      return true;
    }
    if (this._through >= n) return false;

    const k = this._through;
    const uRow = this._row * n;
    const reach = this._cells[uRow + k]!;
    if (reach !== Infinity) {
      const kRow = k * n;
      for (let v = 0; v < n; v++) {
        const candidate = reach + this._cells[kRow + v]!;
        if (candidate < this._cells[uRow + v]!) {
          this._cells[uRow + v] = candidate;
        }
      }
    }

    this._row++;
    if (this._row < n) return true;
    this._row = 0;
    this._through++;
    if (this._through < n) return true;

    for (let u = 0; u < n; u++) {
      if (this._cells[u * n + u]! < 0) throw new Cycle([u]);
    }
    return false;
  }

  public result(): Matrix {
    this.ensure();
    return new Matrix(this._structure.order, this._cells);
  }
}

/**
 * 全源最短路，容许负权。矩阵是 `8·V²` 字节，V=10000 就要 763MB，因此分配前先过规模闸门。
 *
 * @throws {@link Cycle} 存在负权环
 * @throws {@link Oversized} 矩阵超过 `limit`（默认 {@link CEILING}）
 */
export const floydWarshall = (
  structure: Structure,
  options: DenseOptions = {},
): Task<Matrix> => new FloydWarshall(structure, options.limit ?? CEILING);

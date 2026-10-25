import { LazyQueue } from "@openconsole/queue";

import { seek, type Reals } from "../array";
import { mirror, weights, type Adjacency, type Structure } from "../structure";
import { Stepwise, type Task } from "../task";

/** 最小生成森林里选中的一条边，全部是索引。 */
export interface Link {
  readonly source: number;
  readonly target: number;
  readonly weight: number;
  /** 边序号，用 `snapshot.edges[edge]` 换回 id。 */
  readonly edge: number;
}

/**
 * Prim：按无向视角逐个分量扩展。优先队列排的是**节点**——每个尚未入树的节点只记
 * "到树的最小跨边"一条，因此队列规模是 O(V) 而不是 O(E)。
 */
class Prim extends Stepwise<Link[]> {
  private readonly _reach: Float64Array;
  private readonly _from: Int32Array;
  private readonly _slot: Int32Array;
  private readonly _inTree: Uint8Array;
  /** 需额外扫的反向邻接；见 {@link mirror}。 */
  private readonly _inbound: Adjacency | undefined;
  private readonly _weight: Reals | undefined;
  private readonly _queue: LazyQueue;
  private readonly _links: Link[] = [];
  private _root = 0;
  private _seen = 0;

  public constructor(private readonly _structure: Structure) {
    super();
    const n = _structure.order;
    this._queue = new LazyQueue(n);
    this._reach = new Float64Array(n).fill(Infinity);
    this._from = new Int32Array(n).fill(-1);
    this._slot = new Int32Array(n).fill(-1);
    this._inTree = new Uint8Array(n);
    // 生成树是无向概念：缺入向会漏掉整个分支（`0→2, 1→2` 上只给一条边）。
    this._inbound = mirror(_structure, "prim");
    this._weight = weights(_structure);
  }

  protected measure(): number {
    return this.ratio(this._seen, this._structure.order);
  }

  protected step(): boolean {
    const u = this._queue.poll();
    if (u === -1) {
      this._root = seek(this._inTree, this._root, 0);
      if (this._root >= this._structure.order) return false;
      this._reach[this._root] = 0;
      this._queue.push(this._root, 0);
      return true;
    }
    if (this._inTree[u] === 1) return true;
    this._inTree[u] = 1;
    this._seen++;

    if (this._from[u] !== -1) {
      this._links.push({
        source: this._from[u]!,
        target: u,
        weight: this._reach[u]!,
        edge: this._slot[u]!,
      });
    }

    const { offset, other, edge } = this._structure.outbound;
    for (let k = offset[u]!; k < offset[u + 1]!; k++) {
      this._offer(u, other[k]!, edge[k]!);
    }
    const inbound = this._inbound;
    if (inbound) {
      for (let k = inbound.offset[u]!; k < inbound.offset[u + 1]!; k++) {
        this._offer(u, inbound.other[k]!, inbound.edge[k]!);
      }
    }
    return true;
  }

  private _offer(from: number, to: number, slot: number): void {
    if (this._inTree[to] === 1) return;
    const weight = this._weight;
    const cost = weight === undefined ? 1 : weight[slot]!;
    if (cost >= this._reach[to]!) return;
    this._reach[to] = cost;
    this._from[to] = from;
    this._slot[to] = slot;
    this._queue.push(to, cost);
  }

  public result(): Link[] {
    this.ensure();
    return this._links;
  }
}

/**
 * Kruskal：边按权升序合并，并查集判环。
 *
 * @remarks 出队用惰性堆而不是先把边排一遍序。排序是 O(E log E)，也就是整个算法的主项，
 *   摆在构造函数里就等于一半的工作既不受预算约束也中断不了（E=2 万时构造 12.5ms、
 *   推进 14.2ms）。改成边扫邻接边入堆，两段都按节点 / 按边计步，复杂度不变而全程可停。
 */
class Kruskal extends Stepwise<Link[]> {
  private readonly _tail: Int32Array;
  private readonly _head: Int32Array;
  private readonly _parent: Int32Array;
  private readonly _rank: Int32Array;
  private readonly _weight: Reals | undefined;
  private readonly _queue: LazyQueue;
  private readonly _links: Link[] = [];
  /** 建堆游标，走完 `order` 个节点后转入出队阶段。 */
  private _node = 0;
  private _polled = 0;

  public constructor(private readonly _structure: Structure) {
    super();
    this._tail = new Int32Array(_structure.size).fill(-1);
    this._head = new Int32Array(_structure.size);
    this._parent = new Int32Array(_structure.order);
    this._rank = new Int32Array(_structure.order);
    this._weight = weights(_structure);
    this._queue = new LazyQueue(_structure.size);
    for (let u = 0; u < _structure.order; u++) this._parent[u] = u;
  }

  protected measure(): number {
    const total = this._structure.order + this._structure.size;
    return this.ratio(this._node + this._polled, total);
  }

  protected step(): boolean {
    if (this._node < this._structure.order) {
      this._collect(this._node++);
      return true;
    }

    const e = this._queue.poll();
    if (e === -1) return false;
    this._polled++;
    const a = this._find(this._tail[e]!);
    const b = this._find(this._head[e]!);
    if (a !== b) {
      this._union(a, b);
      this._links.push({
        source: this._tail[e]!,
        target: this._head[e]!,
        weight: this._weight === undefined ? 1 : this._weight[e]!,
        edge: e,
      });
    }
    return true;
  }

  /** 记下一个节点出边的两端并入堆；无向结构里同一条边出现两次，只认第一次。 */
  private _collect(u: number): void {
    const { offset, other, edge } = this._structure.outbound;
    const weight = this._weight;
    for (let k = offset[u]!; k < offset[u + 1]!; k++) {
      const e = edge[k]!;
      if (this._tail[e] !== -1) continue;
      const cost = weight === undefined ? 1 : weight[e]!;
      this._tail[e] = u;
      this._head[e] = other[k]!;
      this._queue.push(e, cost);
    }
  }

  private _union(a: number, b: number): void {
    const deep = this._rank[a]!;
    const wide = this._rank[b]!;
    if (deep < wide) {
      this._parent[a] = b;
    } else if (deep > wide) {
      this._parent[b] = a;
    } else {
      this._parent[b] = a;
      this._rank[a] = deep + 1;
    }
  }

  private _find(u: number): number {
    let root = u;
    while (this._parent[root] !== root) root = this._parent[root]!;
    let cursor = u;
    while (cursor !== root) {
      const next = this._parent[cursor]!;
      this._parent[cursor] = root;
      cursor = next;
    }
    return root;
  }

  public result(): Link[] {
    this.ensure();
    return this._links;
  }
}

/** 最小生成森林（Prim）。非连通图给出每个分量各自的最小生成树。 */
export const prim = (structure: Structure): Task<Link[]> => new Prim(structure);

/** 最小生成森林（Kruskal）。 */
export const kruskal = (structure: Structure): Task<Link[]> =>
  new Kruskal(structure);

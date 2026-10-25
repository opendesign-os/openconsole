import { seek } from "../array";
import {
  inboundOf,
  mirror,
  type Adjacency,
  type Structure,
} from "../structure";
import { Stepwise, type Task } from "../task";

/** 桥的两端节点索引。 */
export interface Bridge {
  readonly from: number;
  readonly to: number;
}

export interface Cuts {
  /** 删去后连通分量会增加的边。 */
  readonly bridges: Bridge[];
  /** 删去后连通分量会增加的节点索引。 */
  readonly articulations: Int32Array;
}

/**
 * 桥与割点（Tarjan，无向视角）。有向结构会自动合并两个方向；
 * 平行边靠边序号区分，因此两点间的重边不会被误判为桥。
 */
class Cut extends Stepwise<Cuts> {
  private readonly _discovered: Int32Array;
  private readonly _low: Int32Array;
  private readonly _cut: Uint8Array;
  private readonly _nodes: Int32Array;
  private readonly _via: Int32Array;
  private readonly _cursors: Int32Array;
  private readonly _children: Int32Array;
  private readonly _pending: Int32Array;
  /** 需额外扫的反向邻接；见 {@link mirror}。 */
  private readonly _inbound: Adjacency | undefined;
  private readonly _bridges: Bridge[] = [];
  private _depth = -1;
  private _root = 0;
  private _clock = 0;
  private _other = 0;
  private _edge = 0;

  public constructor(private readonly _structure: Structure) {
    super();
    this._inbound = mirror(_structure, "cuts");
    const n = _structure.order;
    this._discovered = new Int32Array(n).fill(-1);
    this._low = new Int32Array(n);
    this._cut = new Uint8Array(n);
    this._nodes = new Int32Array(n);
    this._via = new Int32Array(n);
    this._cursors = new Int32Array(n);
    this._children = new Int32Array(n);
    this._pending = new Int32Array(n);
  }

  protected measure(): number {
    return this.ratio(this._clock, this._structure.order);
  }

  protected step(): boolean {
    if (this._depth === -1) {
      this._root = seek(this._discovered, this._root, -1);
      if (this._root >= this._structure.order) return false;
      this._enter(this._root, -1);
      return true;
    }

    const u = this._nodes[this._depth]!;
    const child = this._pending[this._depth]!;
    if (child !== -1) {
      this._pending[this._depth] = -1;
      if (this._low[child]! < this._low[u]!) this._low[u] = this._low[child]!;
      if (this._low[child]! > this._discovered[u]!) {
        this._bridges.push({ from: u, to: child });
      }
      if (
        this._via[this._depth] !== -1 &&
        this._low[child]! >= this._discovered[u]!
      ) {
        this._cut[u] = 1;
      }
    }

    while (this._select(u, this._cursors[this._depth]!)) {
      this._cursors[this._depth] = this._cursors[this._depth]! + 1;
      // 不沿来路返回，但平行边（另一个边序号）仍算作返祖边。
      if (this._edge === this._via[this._depth] || this._other === u) continue;
      if (this._discovered[this._other] === -1) {
        this._children[this._depth] = this._children[this._depth]! + 1;
        this._pending[this._depth] = this._other;
        this._enter(this._other, this._edge);
        return true;
      }
      if (this._discovered[this._other]! < this._low[u]!) {
        this._low[u] = this._discovered[this._other]!;
      }
    }

    if (this._via[this._depth] === -1 && this._children[this._depth]! >= 2) {
      this._cut[u] = 1;
    }
    this._depth--;
    return true;
  }

  /** 把关联边（出边在前、入边在后）按序号取到 `_other` / `_edge`。 */
  private _select(u: number, index: number): boolean {
    const { offset, other, edge } = this._structure.outbound;
    const outgoing = offset[u + 1]! - offset[u]!;
    if (index < outgoing) {
      const k = offset[u]! + index;
      this._other = other[k]!;
      this._edge = edge[k]!;
      return true;
    }
    // 无向编译时两侧同源，再扫一遍入向就是把每条边数两次。
    const back = this._inbound;
    if (back === undefined) return false;
    const rest = index - outgoing;
    if (rest >= back.offset[u + 1]! - back.offset[u]!) return false;
    const slot = back.offset[u]! + rest;
    this._other = back.other[slot]!;
    this._edge = back.edge[slot]!;
    return true;
  }

  private _enter(u: number, via: number): void {
    this._discovered[u] = this._low[u] = this._clock++;
    this._depth++;
    this._nodes[this._depth] = u;
    this._via[this._depth] = via;
    this._cursors[this._depth] = 0;
    this._children[this._depth] = 0;
    this._pending[this._depth] = -1;
  }

  public result(): Cuts {
    this.ensure();
    const articulations = new Int32Array(this._structure.order);
    let at = 0;
    for (let u = 0; u < this._structure.order; u++) {
      if (this._cut[u] === 1) articulations[at++] = u;
    }
    return {
      bridges: this._bridges,
      articulations: articulations.subarray(0, at),
    };
  }
}

export const cuts = (structure: Structure): Task<Cuts> => new Cut(structure);

/**
 * 支配树（Lengauer-Tarjan）。只覆盖从 `entry` 可达的节点，`entry` 的直接支配点是自身，
 * 不可达节点为 -1。三个阶段——DFS 编号、半支配点、最终 idom——共享一个游标，
 * 可在任意阶段中断。
 *
 * @remarks 半支配点的桶是一对 `Int32Array` 组成的侵入式单链表（每个节点同时只属于
 *   一个桶），而不是 V 个数组——后者光构造就是 O(V) 次分配。
 */
class Dominators extends Stepwise<Int32Array> {
  private readonly _order: Int32Array;
  private readonly _number: Int32Array;
  private readonly _parent: Int32Array;
  private readonly _semi: Int32Array;
  private readonly _ancestor: Int32Array;
  private readonly _label: Int32Array;
  private readonly _bucketHead: Int32Array;
  private readonly _bucketNext: Int32Array;
  private readonly _idom: Int32Array;
  private readonly _stack: Int32Array;
  private readonly _cursors: Int32Array;
  private readonly _path: Int32Array;
  private readonly _inbound: Adjacency;
  private _depth = 0;
  private _counted = 0;
  private _phase = 0;
  private _cursor = 0;

  public constructor(
    private readonly _structure: Structure,
    entry: number,
  ) {
    super();
    // 半支配点是靠前驱求的：缺入向会让每个节点的 idom 退化成它的 DFS 父节点。
    this._inbound = inboundOf(_structure, "dominators");
    const n = _structure.order;
    this._order = new Int32Array(n).fill(-1);
    this._number = new Int32Array(n).fill(-1);
    this._parent = new Int32Array(n).fill(-1);
    this._semi = new Int32Array(n);
    this._ancestor = new Int32Array(n).fill(-1);
    this._label = new Int32Array(n);
    this._bucketHead = new Int32Array(n).fill(-1);
    this._bucketNext = new Int32Array(n).fill(-1);
    this._idom = new Int32Array(n).fill(-1);
    this._stack = new Int32Array(n);
    this._cursors = new Int32Array(n);
    this._path = new Int32Array(n);

    if (entry < 0 || entry >= n) {
      this._phase = 3;
      return;
    }
    this._number[entry] = 0;
    this._order[0] = entry;
    this._counted = 1;
    this._stack[0] = entry;
    this._cursors[0] = _structure.outbound.offset[entry]!;
    this._depth = 1;
  }

  protected measure(): number {
    return (this._phase + this._fraction()) / 3;
  }

  /** 三个阶段各占三分之一；`_phase` 到 3 时分数为 0，整体正好是 1。 */
  private _fraction(): number {
    const counted = this._counted;
    if (counted === 0) return 0;
    switch (this._phase) {
      case 0:
        return counted / this._structure.order;
      // 阶段 1 的游标是从 counted-1 倒着走到 0 的，直接相除会让进度往回跑。
      case 1:
        return 1 - this._cursor / counted;
      default:
        return this._cursor / counted;
    }
  }

  protected step(): boolean {
    switch (this._phase) {
      case 0:
        return this._enumerate();
      case 1:
        return this._semidominate();
      case 2:
        return this._converge();
      default:
        return false;
    }
  }

  /** 阶段 0：DFS 先序编号。 */
  private _enumerate(): boolean {
    if (this._depth === 0) {
      for (let i = 0; i < this._counted; i++) {
        this._semi[i] = i;
        this._label[i] = i;
      }
      this._phase = 1;
      this._cursor = this._counted - 1;
      return true;
    }

    const top = this._depth - 1;
    const u = this._stack[top]!;
    const { offset, other } = this._structure.outbound;
    if (this._cursors[top]! >= offset[u + 1]!) {
      this._depth--;
      return true;
    }
    const k = this._cursors[top]!;
    this._cursors[top] = k + 1;
    const v = other[k]!;
    if (this._number[v] === -1) {
      const index = this._counted++;
      this._number[v] = index;
      this._order[index] = v;
      this._parent[index] = this._number[u]!;
      this._stack[this._depth] = v;
      this._cursors[this._depth] = offset[v]!;
      this._depth++;
    }
    return true;
  }

  /** 阶段 1：逆先序求半支配点并填桶。 */
  private _semidominate(): boolean {
    if (this._cursor <= 0) {
      this._phase = 2;
      this._cursor = 1;
      return true;
    }
    const w = this._cursor--;

    const node = this._order[w]!;
    const back = this._inbound;
    for (let k = back.offset[node]!; k < back.offset[node + 1]!; k++) {
      const number = this._number[back.other[k]!]!;
      if (number === -1) continue;
      const candidate = this._evaluate(number);
      if (this._semi[candidate]! < this._semi[w]!) {
        this._semi[w] = this._semi[candidate]!;
      }
    }

    const bucket = this._semi[w]!;
    this._bucketNext[w] = this._bucketHead[bucket]!;
    this._bucketHead[bucket] = w;
    this._ancestor[w] = this._parent[w]!;

    const parent = this._parent[w]!;
    for (let v = this._bucketHead[parent]!; v !== -1; ) {
      const next = this._bucketNext[v]!;
      this._bucketNext[v] = -1;
      const candidate = this._evaluate(v);
      this._idom[v] =
        this._semi[candidate]! < this._semi[v]! ? candidate : parent;
      v = next;
    }
    this._bucketHead[parent] = -1;
    return true;
  }

  /** 阶段 2：把间接支配点收敛成直接支配点。 */
  private _converge(): boolean {
    if (this._cursor >= this._counted) {
      this._phase = 3;
      return false;
    }
    const w = this._cursor++;
    if (this._idom[w] !== this._semi[w]) {
      this._idom[w] = this._idom[this._idom[w]!]!;
    }
    return true;
  }

  private _evaluate(v: number): number {
    if (this._ancestor[v] === -1) return v;
    this._compress(v);
    return this._label[v]!;
  }

  private _compress(v: number): void {
    let depth = 0;
    let cursor = v;
    while (this._ancestor[this._ancestor[cursor]!] !== -1) {
      this._path[depth++] = cursor;
      cursor = this._ancestor[cursor]!;
    }
    for (let i = depth - 1; i >= 0; i--) {
      const w = this._path[i]!;
      const ancestor = this._ancestor[w]!;
      if (this._semi[this._label[ancestor]!]! < this._semi[this._label[w]!]!) {
        this._label[w] = this._label[ancestor]!;
      }
      this._ancestor[w] = this._ancestor[ancestor]!;
    }
  }

  /** `idom[u]` 是节点索引 `u` 的直接支配点；入口指向自身，不可达为 -1。 */
  public result(): Int32Array {
    this.ensure();
    const tree = new Int32Array(this._structure.order).fill(-1);
    if (this._counted === 0) return tree;
    const root = this._order[0]!;
    tree[root] = root;
    for (let w = 1; w < this._counted; w++) {
      tree[this._order[w]!] = this._order[this._idom[w]!]!;
    }
    return tree;
  }
}

export const dominators = (
  structure: Structure,
  entry: number,
): Task<Int32Array> => new Dominators(structure, entry);

import { bucket, seek, type Ints } from "../array";
import { mirror, type Adjacency, type Structure } from "../structure";
import { chain, Stepwise, transform, type Task } from "../task";

/** 分量划分：`component[u]` 是节点索引 `u` 所属分量的编号。 */
export class Partition {
  public constructor(
    public readonly count: number,
    public readonly component: Ints,
  ) {}

  /** 按分量编号分组的节点索引。 */
  public groups(): Int32Array[] {
    return bucket(this.component, this.count);
  }
}

/** 弱连通分量：忽略边方向。 */
class Weak extends Stepwise<Partition> {
  private readonly _component: Int32Array;
  private readonly _stack: Int32Array;
  /** 需额外扫的反向邻接；见 {@link mirror}。 */
  private readonly _inbound: Adjacency | undefined;
  private _top = 0;
  private _root = 0;
  private _count = 0;
  private _seen = 0;

  public constructor(private readonly _structure: Structure) {
    super();
    this._component = new Int32Array(_structure.order).fill(-1);
    this._stack = new Int32Array(_structure.order);
    // 弱连通要忽略方向：缺入向就只能沿出边走，得到的是按可达性的分组而非弱连通分量
    // （`0→2, 1→2` 会报成两个分量）。
    this._inbound = mirror(_structure, "components");
  }

  protected measure(): number {
    return this.ratio(this._seen, this._structure.order);
  }

  protected step(): boolean {
    if (this._top === 0) {
      this._root = seek(this._component, this._root, -1);
      if (this._root >= this._structure.order) return false;
      this._claim(this._root, this._count++);
      return true;
    }

    const u = this._stack[--this._top]!;
    const label = this._component[u]!;
    const { offset, other } = this._structure.outbound;
    for (let k = offset[u]!; k < offset[u + 1]!; k++) {
      this._claim(other[k]!, label);
    }
    const inbound = this._inbound;
    if (inbound) {
      for (let k = inbound.offset[u]!; k < inbound.offset[u + 1]!; k++) {
        this._claim(inbound.other[k]!, label);
      }
    }
    return true;
  }

  private _claim(u: number, label: number): void {
    if (this._component[u] !== -1) return;
    this._component[u] = label;
    this._stack[this._top++] = u;
    this._seen++;
  }

  public result(): Partition {
    this.ensure();
    return new Partition(this._count, this._component);
  }
}

/**
 * 强连通分量（Pearce 2016 迭代算法）。DFS 栈是四条平行 `Int32Array`，每帧零分配，
 * 因此整个搜索过程都能安全地在任意一步暂停。分量编号按逆拓扑序递增。
 */
class Strong extends Stepwise<Partition> {
  /** 0 未访问；正数为先序值（随后被低链值压低）；负数表示已归入分量。 */
  private readonly _rindex: Int32Array;
  private readonly _component: Int32Array;
  private readonly _nodes: Int32Array;
  private readonly _marks: Int32Array;
  private readonly _cursors: Int32Array;
  private readonly _pending: Int32Array;
  private readonly _path: Int32Array;
  private _pathTop = 0;
  private _depth = -1;
  private _root = 0;
  private _preorder = 1;
  private _count = 0;
  private _settledNodes = 0;

  public constructor(private readonly _structure: Structure) {
    super();
    const n = _structure.order;
    this._rindex = new Int32Array(n);
    this._component = new Int32Array(n).fill(-1);
    this._nodes = new Int32Array(n);
    this._marks = new Int32Array(n);
    this._cursors = new Int32Array(n);
    this._pending = new Int32Array(n);
    this._path = new Int32Array(n);
  }

  protected measure(): number {
    return this.ratio(this._settledNodes, this._structure.order);
  }

  protected step(): boolean {
    if (this._depth === -1) {
      this._root = seek(this._rindex, this._root, 0);
      if (this._root >= this._structure.order) return false;
      this._enter(this._root);
      return true;
    }

    const u = this._nodes[this._depth]!;
    const child = this._pending[this._depth]!;
    if (child !== -1) {
      this._pending[this._depth] = -1;
      const low = this._rindex[child]!;
      if (low > 0 && low < this._rindex[u]!) this._rindex[u] = low;
    }

    const { offset, other } = this._structure.outbound;
    const end = offset[u + 1]!;
    let cursor = this._cursors[this._depth]!;
    while (cursor < end) {
      const v = other[cursor]!;
      cursor++;
      const mark = this._rindex[v]!;
      if (mark === 0) {
        this._cursors[this._depth] = cursor;
        this._pending[this._depth] = v;
        this._enter(v);
        return true;
      }
      if (mark > 0 && mark < this._rindex[u]!) this._rindex[u] = mark;
    }
    this._cursors[this._depth] = cursor;

    // 低链值没有被压低 ⇒ u 是分量根，弹出它之上的全部候选成员。
    if (this._rindex[u] === this._marks[this._depth]) {
      const label = this._count++;
      let member: number;
      do {
        member = this._path[--this._pathTop]!;
        this._rindex[member] = -(label + 1);
        this._component[member] = label;
        this._settledNodes++;
      } while (member !== u);
    }
    this._depth--;
    return true;
  }

  private _enter(u: number): void {
    const mark = this._preorder++;
    this._rindex[u] = mark;
    this._depth++;
    this._nodes[this._depth] = u;
    this._marks[this._depth] = mark;
    this._cursors[this._depth] = this._structure.outbound.offset[u]!;
    this._pending[this._depth] = -1;
    this._path[this._pathTop++] = u;
  }

  public result(): Partition {
    this.ensure();
    return new Partition(this._count, this._component);
  }
}

export const components = (structure: Structure): Task<Partition> =>
  new Weak(structure);

export const scc = (structure: Structure): Task<Partition> =>
  new Strong(structure);

export interface Condensed {
  readonly partition: Partition;
  /** 分量间的去重有向边。 */
  readonly edges: Array<readonly [number, number]>;
}

/** 缩点：每个强连通分量收缩成一个节点，得到无环的凝聚图。 */
export const condensation = (structure: Structure): Task<Condensed> =>
  transform(scc(structure), (partition) => {
    const { order } = structure;
    const { offset, other } = structure.outbound;
    const seen = new Set<number>();
    const edges: Array<readonly [number, number]> = [];
    for (let u = 0; u < order; u++) {
      const from = partition.component[u]!;
      for (let k = offset[u]!; k < offset[u + 1]!; k++) {
        const to = partition.component[other[k]!]!;
        if (to === from) continue;
        // count < 2²⁶ 时不超过 2⁵³，键精确；标签层远在那个规模前就先耗尽内存了。
        const key = from * partition.count + to;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push([from, to]);
      }
    }
    return { partition, edges };
  });

/**
 * 枚举全部简单环（Johnson）。环的数量可能随规模爆炸，务必配合中断使用。
 *
 * @remarks 搜索限制在起点所属的强连通分量内——环不可能跨分量，DAG 上因此只剩
 *   一遍 O(V+E) 的跳过。B 列表是 `Set`：Johnson 的 unblock 要反复判成员，
 *   用数组线性查找会把发布的复杂度界打破；但按需才建，否则 DAG 上会白分配 V 个 `Set`。
 */
class Cycles extends Stepwise<number[][]> {
  private readonly _component: Ints;
  private readonly _groups: Int32Array[];
  private readonly _blocked: Uint8Array;
  /** B 列表：`_noEntry[v]` 是"v 解封后要跟着解封"的节点，缺省即空。 */
  private readonly _noEntry: Array<Set<number> | undefined>;
  private readonly _path: number[] = [];
  private readonly _frames: number[] = [];
  private readonly _cursors: number[] = [];
  private readonly _found: boolean[] = [];
  private readonly _cycles: number[][] = [];
  private _start = 0;

  public constructor(
    private readonly _structure: Structure,
    partition: Partition,
  ) {
    super();
    this._component = partition.component;
    this._groups = partition.groups();
    this._blocked = new Uint8Array(_structure.order);
    this._noEntry = new Array(_structure.order);
  }

  protected measure(): number {
    return this.ratio(this._start, this._structure.order);
  }

  protected step(): boolean {
    if (this._frames.length === 0) {
      if (this._start >= this._structure.order) return false;
      if (!this._cyclic(this._start)) {
        this._start++;
        return true;
      }
      for (const member of this._groups[this._component[this._start]!]!) {
        this._blocked[member] = 0;
        this._noEntry[member] = undefined;
      }
      this._enter(this._start);
      return true;
    }

    const top = this._frames.length - 1;
    const u = this._frames[top]!;
    const { offset, other } = this._structure.outbound;
    const end = offset[u + 1]!;

    if (this._cursors[top]! < end) {
      const v = other[this._cursors[top]!++]!;
      if (v < this._start) return true;
      if (this._component[v] !== this._component[u]) return true;
      if (v === this._start) {
        this._cycles.push([...this._path]);
        this._found[top] = true;
      } else if (this._blocked[v] === 0) {
        this._enter(v);
      }
      return true;
    }

    if (this._found[top]) {
      this._unblock(u);
    } else {
      for (let k = offset[u]!; k < end; k++) {
        const v = other[k]!;
        if (v >= this._start && this._component[v] === this._component[u]) {
          (this._noEntry[v] ??= new Set()).add(u);
        }
      }
    }

    this._frames.pop();
    this._cursors.pop();
    this._path.pop();
    const found = this._found.pop()!;
    if (found && this._frames.length > 0) {
      this._found[this._frames.length - 1] = true;
    }
    if (this._frames.length === 0) this._start++;
    return true;
  }

  private _cyclic(start: number): boolean {
    if (this._groups[this._component[start]!]!.length > 1) return true;
    const { offset, other } = this._structure.outbound;
    for (let k = offset[start]!; k < offset[start + 1]!; k++) {
      if (other[k] === start) return true;
    }
    return false;
  }

  private _enter(u: number): void {
    this._path.push(u);
    this._blocked[u] = 1;
    this._frames.push(u);
    this._cursors.push(this._structure.outbound.offset[u]!);
    this._found.push(false);
  }

  private _unblock(root: number): void {
    const waiting = [root];
    while (waiting.length > 0) {
      const u = waiting.pop()!;
      this._blocked[u] = 0;
      const dependents = this._noEntry[u];
      if (dependents === undefined) continue;
      this._noEntry[u] = undefined;
      for (const blocked of dependents) {
        if (this._blocked[blocked] === 1) waiting.push(blocked);
      }
    }
  }

  public result(): number[][] {
    this.ensure();
    return this._cycles;
  }
}

export const simpleCycles = (structure: Structure): Task<number[][]> =>
  chain(scc(structure), (partition) => new Cycles(structure, partition));

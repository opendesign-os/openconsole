import { scc } from "./algorithm/component";
import { topology } from "./algorithm/order";
import type { Graph } from "./graph";
import type { NodeId } from "./ident";
import { Snapshot } from "./snapshot";
import { settle } from "./task";

/**
 * 增量维护的拓扑序（Pearce-Kelly）：订阅图事件就地重排，不整图重算。
 *
 * 造成环的边不触发重算，而是记入 {@link Ordering.conflicts} 并从拓扑约束中排除——
 * 剩下的子图始终是 DAG，顺序始终有效。因此"图里长期带环"这种编辑器常态不会把
 * 每次变更都退化成 O(V+E)。删边使环消失时，被排除的边会自动回到约束里，
 * {@link Ordering.cyclic} 与 {@link Ordering.cycles} 因此始终对得上。
 *
 * @remarks 全部内部状态按**整数槽位**存放：位次是一条 `Int32Array`，冲突边是一个数字
 *   `Set`，区域搜索走 {@link Graph.forEachOutAt}。事件载荷自带 `slot`，因此除了建边时
 *   取两端槽位的那两次查表，整条增量路径不碰字符串。`compact()` 重新编号时按 `compacted`
 *   给的映射原地搬运，而不是整图重算。
 */
export class Ordering<N = unknown, E = unknown> {
  /**
   * 位次 + 1，`0` 表示该槽位不在跟踪范围内（从未登记、已删除，或 `dispose` 之后新增的）。
   * 全体统一偏移不影响任何比较，却省掉一条并行的「是否有效」位图。
   */
  private _rank: Int32Array;
  private readonly _conflicts = new Set<number>();
  private readonly _unsubscribe: Array<() => void> = [];
  private _next = 1;

  public constructor(private readonly _graph: Graph<N, E>) {
    this._rank = new Int32Array(0);
    this._reset();
    const signal = _graph.signal;
    this._unsubscribe.push(
      signal.on("nodeAdded", ({ slot }) => {
        this._fit(slot);
        this._rank[slot] = this._next++;
      }),
      signal.on("nodeDropped", ({ slot }) => {
        this._rank[slot] = 0;
      }),
      signal.on("edgeAdded", ({ slot, source, target }) => {
        this._insert(slot, _graph.indexOf(source), _graph.indexOf(target));
      }),
      signal.on("edgeDropped", ({ slot }) => {
        // 删边不可能破坏既有顺序；撤销它的冲突登记后，再看其余冲突边能否回到约束里——
        // 消失的环未必途经被删的这条边。
        this._conflicts.delete(slot);
        this._revive();
      }),
      signal.on("compacted", ({ nodes, edges }) => {
        this._remap(nodes, edges);
      }),
    );
  }

  /** 节点不存在或不在跟踪范围内时返回 `undefined`。 */
  public rank(node: NodeId): number | undefined {
    const at = this.rankAt(this._graph.indexOf(node));
    return at === -1 ? undefined : at;
  }

  /** 按槽位取位次，零哈希；未跟踪返回 -1。 */
  public rankAt(slot: number): number {
    if (slot < 0) return -1;
    const stored = this._rank[slot] ?? 0;
    return stored === 0 ? -1 : stored - 1;
  }

  /** 可直接用作 `sort` 比较器；任一节点缺失时视为相等。 */
  public compare(a: NodeId, b: NodeId): number {
    const left = this.rank(a);
    const right = this.rank(b);
    return left === undefined || right === undefined ? 0 : left - right;
  }

  /** 未跟踪的（位次 0）自然排在最前，与"尚未纳入约束"的语义一致。 */
  public sorted(): NodeId[] {
    // 排的是槽位而不是 `{ id, rank }` 对：整数数组的比较器不解引用对象，也不为每个
    // 节点分配一个临时对象——V 大时那批对象本身就够触发一次 GC。
    const slots: number[] = [];
    this._graph.forEachNode((_id, _weight, slot) => void slots.push(slot));
    slots.sort((a, b) => (this._rank[a] ?? 0) - (this._rank[b] ?? 0));
    return slots.map((slot) => this._graph.nodeIdAt(slot)!);
  }

  /** 是否存在被排除的成环边。O(1)。 */
  public get cyclic(): boolean {
    return this._conflicts.size > 0;
  }

  /** 因成环而被排除在拓扑约束之外的边槽位。 */
  public get conflicts(): ReadonlySet<number> {
    return this._conflicts;
  }

  /** 参与环的节点，按分量分组。按需计算，O(V+E)。 */
  public cycles(): NodeId[][] {
    if (this._conflicts.size === 0) return [];
    const snapshot = Snapshot.of(this._graph);
    return settle(scc(snapshot))
      .groups()
      .filter((members) => {
        if (members.length > 1) return true;
        const only = snapshot.node(members[0]!);
        return this._graph.adjacent(only, only);
      })
      .map((members) => snapshot.names(members));
  }

  /** 丢弃增量状态并整图重算。 */
  public refresh(): void {
    this._reset();
  }

  public dispose(): void {
    for (const off of this._unsubscribe) off();
    this._unsubscribe.length = 0;
  }

  private _fit(slot: number): void {
    if (slot < this._rank.length) return;
    const grown = new Int32Array(Math.max(16, (slot + 1) * 2));
    grown.set(this._rank);
    this._rank = grown;
  }

  private _reset(): void {
    const snapshot = Snapshot.of(this._graph);
    const result = settle(topology(snapshot));
    this._rank = new Int32Array(Math.max(16, this._graph.bound));
    this._conflicts.clear();
    this._next = 1;

    // 快照索引 → 图槽位：无谓词的编译按存储顺序逐个收下节点，因此第 i 个快照节点
    // 就是第 i 个非空槽位，重走一遍即可对齐，不必逐个查 id。
    const slotOf = new Int32Array(snapshot.order);
    let at = 0;
    this._graph.forEachNode((_id, _weight, slot) => {
      slotOf[at++] = slot;
    });
    for (const u of result.order) this._rank[slotOf[u]!] = this._next++;
    for (const u of result.cycle) this._rank[slotOf[u]!] = this._next++;

    // 环节点的相对顺序是任意的，把逆序的那些边挑出来排除，剩下的仍是合法拓扑序。
    for (const u of result.cycle) {
      const slot = slotOf[u]!;
      const from = this._rank[slot]!;
      this._graph.forEachOutAt(slot, (target, edge) => {
        if (from >= this._rank[target]!) this._conflicts.add(edge);
      });
    }
  }

  /**
   * 删边后让冲突边逐条重试，回到拓扑约束里——消失的环未必途经被删的那条边。
   *
   * @remarks 单趟足够：{@link Ordering._insert} 只会**增加**约束（重排位次不改变成环与否），
   *   因此本趟里失败过的边不可能在同一趟后面反而变得可插入。
   */
  private _revive(): void {
    // 先拷一份：`_insert` 会把仍然成环的边放回集合，边迭代边加会重复访问同一条。
    for (const slot of [...this._conflicts]) {
      this._conflicts.delete(slot);
      // 事务里同批被删的边：图已是最终状态，事件还在队列里，清掉登记即可。
      const record = this._graph.edgeAt(slot);
      if (record === undefined) continue;
      this._insert(
        slot,
        this._graph.indexOf(record.source),
        this._graph.indexOf(record.target),
      );
    }
  }

  private _remap(nodes: Int32Array, edges: Int32Array): void {
    const moved = new Int32Array(Math.max(16, this._graph.bound));
    for (let i = 0; i < nodes.length; i++) {
      const to = nodes[i]!;
      if (to >= 0) moved[to] = this._rank[i] ?? 0;
    }
    this._rank = moved;

    const conflicts = [...this._conflicts];
    this._conflicts.clear();
    for (const edge of conflicts) {
      const to = edges[edge];
      if (to !== undefined && to >= 0) this._conflicts.add(to);
    }
  }

  private _insert(edge: number, source: number, target: number): void {
    if (source < 0 || target < 0) return;
    this._fit(source);
    this._fit(target);
    const from = this._rank[source]!;
    const to = this._rank[target]!;
    if (from === 0 || to === 0 || from < to) return;

    const ahead = this._region(target, from, true, source);
    if (ahead === null) {
      this._conflicts.add(edge);
      return;
    }
    const behind = this._region(source, to, false);

    const byRank = (a: number, b: number): number =>
      this._rank[a]! - this._rank[b]!;
    behind.sort(byRank);
    ahead.sort(byRank);

    // 两区必然不相交：若有节点同属两侧，则 target →* 它 →* source，`_region` 撞上
    // stop 早已返回 null。因此位次只是在这批节点内部重排，不会漏发或重发。
    const positions = [...behind, ...ahead]
      .map((slot) => this._rank[slot]!)
      .sort((a, b) => a - b);
    let cursor = 0;
    for (const slot of behind) this._rank[slot] = positions[cursor++]!;
    for (const slot of ahead) this._rank[slot] = positions[cursor++]!;
  }

  private _region(start: number, bound: number, outward: boolean): number[];
  private _region(
    start: number,
    bound: number,
    outward: boolean,
    stop: number,
  ): number[] | null;
  /**
   * 收集受影响的区域：`outward` 为真时沿出边找位次不超过 `bound` 的后代，
   * 否则沿入边找位次不低于 `bound` 的祖先。碰到 `stop` 说明成环，返回 `null`。
   */
  private _region(
    start: number,
    bound: number,
    outward: boolean,
    stop?: number,
  ): number[] | null {
    const seen = new Set<number>([start]);
    const region: number[] = [start];
    const stack: number[] = [start];
    let cyclic = false;

    // 闭包建在循环外：区域最大可达全图，每弹一个节点重建一次就是 O(V) 次分配。
    const expand = (other: number, edge: number): boolean | void => {
      if (this._conflicts.has(edge)) return;
      if (other === stop) {
        cyclic = true;
        return false;
      }
      if (seen.has(other)) return;
      const rank = this._rank[other];
      if (rank === undefined || rank === 0) return;
      if (outward ? rank > bound : rank < bound) return;
      seen.add(other);
      region.push(other);
      stack.push(other);
    };

    while (stack.length > 0) {
      const slot = stack.pop()!;
      if (outward) this._graph.forEachOutAt(slot, expand);
      else this._graph.forEachInAt(slot, expand);
      if (cyclic) return null;
    }
    return region;
  }
}

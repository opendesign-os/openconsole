/**
 * 图驱动的顺序原语:把「先后声明」建成
 * {@link https://www.npmjs.com/package/@openconsole/graph | @openconsole/graph} 的有向图,
 * 编译出执行序、可并行分层与诊断。插件之间和单个 hook 内 tap 之间共用它 —— 桶分别是
 * `enforce` 与 `stage`。
 *
 * 顺序 = 按 `(bucket, layer, tiebreak, 拓扑位次)` 排。前两项与边同向:同桶内 `u → v` 必有
 * `layer[v] > layer[u]`,跨桶则桶已定先后。于是一次排序同时满足分相与依赖,而 `sequence`
 * 相邻的一段恰好是一个可并行层。
 */

import {
  Graph,
  graphId,
  nodeId,
  scc,
  settle,
  Snapshot,
  Socket,
  topology,
  Vertex,
  type NodeId,
  type Sockets,
} from "@openconsole/graph";

/** 一个可排序单元。 */
export interface Step {
  /** 图内唯一标识。 */
  readonly key: string;
  /** 供 `before` / `after` 引用的名字;允许重名,同名的**全部**被约束。 */
  readonly name: string;
  /** 硬分相:桶序先于先后序,数值越小越先。 */
  readonly bucket: number;
  /** 须先于这些名字。引用不存在的名字则忽略。 */
  readonly before?: readonly string[] | undefined;
  /** 须后于这些名字。引用不存在的名字则忽略。 */
  readonly after?: readonly string[] | undefined;
}

export interface Placement {
  readonly bucket: number;
  /** 同桶内的最长路深度;同 `(bucket, layer)` 互不依赖 → 可并行。 */
  readonly layer: number;
  readonly sequence: number;
}

/** 一条声明要求 `from` 先于 `to`,而分相要求反过来 —— 无解。 */
export interface Conflict {
  readonly from: string;
  readonly to: string;
  readonly fromBucket: number;
  readonly toBucket: number;
}

/** 编译好的执行计划,不可变 —— 取出之后不受后续增删影响。 */
export interface Plan<T> {
  readonly order: readonly T[];
  /** 同 `(bucket, layer)` 一组,组内互不依赖,组间有序。 */
  readonly layers: ReadonlyArray<readonly T[]>;
  readonly at: ReadonlyMap<string, Placement>;
  /** 成环的强连通分量,按 `name` 给出。 */
  readonly cycles: readonly string[][];
  readonly conflicts: readonly Conflict[];
}

export class CycleError extends Error {
  public constructor(
    public readonly components: readonly string[][],
    subject = "先后声明",
  ) {
    super(
      `${subject}成环(强连通分量):\n` +
        components.map((members) => `  { ${members.join(", ")} }`).join("\n"),
    );
    this.name = "CycleError";
  }
}

export class PhaseError extends Error {
  public constructor(
    public readonly conflicts: readonly Conflict[],
    subject = "先后声明",
    label: (bucket: number) => string = String,
  ) {
    super(
      `${subject}与分相矛盾:\n` +
        conflicts
          .map((c) => `  ${c.from}(${label(c.fromBucket)}) 须先于 ${c.to}(${label(c.toBucket)})`)
          .join("\n"),
    );
    this.name = "PhaseError";
  }
}

export interface PipelineOptions<T> {
  /** 诊断消息里的主体,如 `插件依赖` / `hook "transform" 的 tap 顺序`。 */
  subject?: string | undefined;
  /** 桶的可读名,如 `0 → "pre 相"`。 */
  label?: ((bucket: number) => string) | undefined;
  /** 同桶同层时的兜底比较;返回 0 则退回注册序。 */
  tiebreak?: ((a: T, b: T) => number) | undefined;
  /** 外部顺序版本号 —— 权重来自图外时靠它判断要不要重排。 */
  epoch?: (() => number) | undefined;
}

/** 拓扑分析结果:只随**结构**变化,与外部权重无关。 */
interface Analysis<T> {
  /** 拓扑序的节点索引,环上的接在后面。 */
  readonly listed: Int32Array;
  readonly items: readonly T[];
  readonly bucket: Float64Array;
  readonly layer: Int32Array;
  readonly position: Int32Array;
  readonly cycles: readonly string[][];
  readonly conflicts: readonly Conflict[];
}

const EMPTY: Plan<never> = { order: [], layers: [], at: new Map(), cycles: [], conflicts: [] };

const declares = (step: Step): boolean =>
  (step.before?.length ?? 0) > 0 || (step.after?.length ?? 0) > 0;

/**
 * 一条流水线。图就是权威存储 —— 单元存在节点权重上,没有第二份索引。
 *
 * 两级缓存对应 graph 区分的两个版本号:拓扑分析随 `shape`(结构)失效,最终排序随 `revision`
 * 与外部 `epoch` 失效。于是「又注册了一个插件」只让没被它 tap 的 hook 重排一次数组,不必重连
 * 边、重编译快照、重跑拓扑。
 */
export class Pipeline<T extends Step> {
  public readonly graph: Graph<T, void>;

  private readonly subject: string;
  private readonly label: (bucket: number) => string;
  private readonly tiebreak: (a: T, b: T) => number;
  private readonly epoch: () => number;

  /** 带 `before` / `after` 的单元数;为 0 则连边整个跳过。 */
  private declared = 0;
  private analyzed: Analysis<T> | undefined;
  private planned: Plan<T> | undefined;
  /** 各级缓存对应的版本号。 */
  private readonly mark = { linked: -1, shape: -1, revision: -1, epoch: -1 };

  public constructor(id: string, options: PipelineOptions<T> = {}) {
    this.graph = new Graph<T, void>(graphId(id));
    this.subject = options.subject ?? "先后声明";
    this.label = options.label ?? String;
    this.tiebreak = options.tiebreak ?? (() => 0);
    this.epoch = options.epoch ?? (() => 0);
  }

  public get size(): number {
    return this.graph.order;
  }

  public has(key: string): boolean {
    return this.graph.hasNode(nodeId(key));
  }

  /** `key` 重复会抛 graph 的 `Duplicate`。 */
  public add(item: T): void {
    this.graph.addNode(
      new Vertex<Sockets, Sockets, T>(nodeId(item.key), item)
        .addInput("in", Socket.exec)
        .addOutput("out", Socket.exec),
    );
    if (declares(item)) this.declared++;
  }

  public remove(key: string): boolean {
    const id = nodeId(key);
    const item = this.graph.nodeWeight(id);
    if (!this.graph.dropNode(id)) return false;
    if (item && declares(item)) this.declared--;
    return true;
  }

  /** 批量增删只派发一次图事件。 */
  public batch<R>(work: () => R): R {
    return this.graph.batch(work);
  }

  /** 丢弃排序结果,保留拓扑分析 —— 外部权重变了但结构没变时用。 */
  public invalidate(): void {
    this.planned = undefined;
  }

  /** 没变就是同一个对象。 */
  public plan(): Plan<T> {
    const epoch = this.epoch();
    const { mark } = this;
    if (this.planned && mark.revision === this.graph.revision && mark.epoch === epoch) {
      return this.planned;
    }
    this.planned = this.graph.order === 0 ? (EMPTY as Plan<T>) : this.arrange(this.analysis());
    // 连边也推进 revision,故位次要在分析之后取。
    mark.revision = this.graph.revision;
    mark.epoch = epoch;
    return this.planned;
  }

  /**
   * @throws {@link CycleError} 先后声明成环
   * @throws {@link PhaseError} 先后声明与分相矛盾
   */
  public verify(): void {
    const plan = this.plan();
    if (plan.cycles.length > 0) throw new CycleError(plan.cycles, this.subject);
    if (plan.conflicts.length > 0) throw new PhaseError(plan.conflicts, this.subject, this.label);
  }

  private analysis(): Analysis<T> {
    this.link();
    if (this.analyzed && this.mark.shape === this.graph.shape) return this.analyzed;
    this.analyzed = this.analyze();
    this.mark.shape = this.graph.shape;
    return this.analyzed;
  }

  /**
   * 按声明重建全部边。
   *
   * @remarks 单元是一个个到的(hook 的 tap 就是),前向引用在到达时对方还不在图里,因此不做
   *   增量连边。整体重连按 `shape` 去重,一批增删只付一次 O(V+E)。
   */
  private link(): void {
    if (this.mark.linked === this.graph.shape) return;
    if (this.declared === 0) {
      if (this.graph.size > 0) this.graph.clearEdges();
      this.mark.linked = this.graph.shape;
      return;
    }

    const names = new Map<string, NodeId[]>();
    const listed: Array<{ id: NodeId; item: T }> = [];
    this.graph.forEachNode((id, item) => {
      if (!item) return;
      listed.push({ id, item });
      const same = names.get(item.name);
      if (same) same.push(id);
      else names.set(item.name, [id]);
    });

    this.graph.batch(() => {
      this.graph.clearEdges();
      for (const { id, item } of listed) {
        for (const name of item.after ?? []) {
          for (const from of names.get(name) ?? []) this.edge(from, id);
        }
        for (const name of item.before ?? []) {
          for (const to of names.get(name) ?? []) this.edge(id, to);
        }
      }
    });
    this.mark.linked = this.graph.shape;
  }

  private edge(from: NodeId, to: NodeId): void {
    if (from === to) return; // 同名单元里的自己
    if (this.graph.adjacent(from, to)) return; // 两种写法只该有一条边
    this.graph.connect([from, "out"], [to, "in"]);
  }

  private analyze(): Analysis<T> {
    const snapshot = Snapshot.of(this.graph);
    const { order, cycle } = settle(topology(snapshot));

    // 环上单元接在无环部分之后:带环时顺序降级但不崩塌,报错的责任收在 verify() 一处。
    const listed = new Int32Array(order.length + cycle.length);
    listed.set(order, 0);
    listed.set(cycle, order.length);

    const items: T[] = new Array(snapshot.order);
    const bucket = new Float64Array(snapshot.order);
    for (let u = 0; u < snapshot.order; u++) {
      const item = this.graph.nodeWeight(snapshot.node(u))!;
      items[u] = item;
      bucket[u] = item.bucket;
    }

    // 跨桶的边不加深度 —— 分相本身已经把两者隔开了。
    const layer = new Int32Array(snapshot.order);
    const { offset, other } = snapshot.outbound;
    for (const u of listed) {
      const depth = layer[u]!;
      for (let k = offset[u]!; k < offset[u + 1]!; k++) {
        const v = other[k]!;
        if (bucket[v] === bucket[u] && layer[v]! <= depth) layer[v] = depth + 1;
      }
    }

    const position = new Int32Array(snapshot.order);
    for (let at = 0; at < listed.length; at++) position[listed[at]!] = at;

    return {
      listed,
      items,
      bucket,
      layer,
      position,
      cycles: cycle.length === 0 ? [] : this.components(snapshot),
      conflicts: this.conflicts(),
    };
  }

  private arrange({ listed, items, bucket, layer, position, cycles, conflicts }: Analysis<T>): Plan<T> {
    const sorted = Array.from(listed).sort(
      (a, b) =>
        bucket[a]! - bucket[b]! ||
        layer[a]! - layer[b]! ||
        this.tiebreak(items[a]!, items[b]!) ||
        position[a]! - position[b]!,
    );

    const order: T[] = [];
    const layers: T[][] = [];
    const at = new Map<string, Placement>();
    let group: T[] = [];
    let phase = Number.NaN; // NaN !== 任何值,于是第一项必然开新层
    let depth = -1;

    for (let sequence = 0; sequence < sorted.length; sequence++) {
      const u = sorted[sequence]!;
      const item = items[u]!;
      const b = bucket[u]!;
      const l = layer[u]!;
      if (b !== phase || l !== depth) {
        group = [];
        layers.push(group);
        phase = b;
        depth = l;
      }
      group.push(item);
      order.push(item);
      at.set(item.key, { bucket: b, layer: l, sequence });
    }

    return { order, layers, at, cycles, conflicts };
  }

  private components(snapshot: Snapshot): string[][] {
    return settle(scc(snapshot))
      .groups()
      .filter((members) => {
        if (members.length > 1) return true;
        const only = snapshot.node(members[0]!);
        return this.graph.adjacent(only, only);
      })
      .map((members) =>
        Array.from(members, (u) => {
          const id = snapshot.node(u);
          return this.graph.nodeWeight(id)?.name ?? String(id);
        }),
      );
  }

  private conflicts(): Conflict[] {
    const conflicts: Conflict[] = [];
    this.graph.forEachEdge(({ source, target }) => {
      const from = this.graph.nodeWeight(source);
      const to = this.graph.nodeWeight(target);
      if (!from || !to || from.bucket <= to.bucket) return;
      conflicts.push({
        from: from.name,
        to: to.name,
        fromBucket: from.bucket,
        toBucket: to.bucket,
      });
    });
    return conflicts;
  }
}

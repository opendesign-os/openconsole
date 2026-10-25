/**
 * 从可变 {@link Graph} 编译出的不可变 CSR 快照。
 *
 * @remarks 契约本身（{@link Structure} 与它的派生量）在 `./structure`，那个模块不认识
 *   `Graph`；编译的机器在 `./compile`。这里只有成品：{@link Structure} 的默认实现、
 *   索引 ↔ id 的标签层，以及跨线程的搬运与还原。
 *
 * @packageDocumentation
 */

import type { Ints, Reals } from "./array";
import {
  compile,
  nodeCosts,
  recipeOf,
  sameLayers,
  edgeWeights,
  type Recipe,
  type Source,
} from "./compile";
import { Schema, Stale } from "./error";
import type { Graph, Wire } from "./graph";
import type { EdgeId, GraphId, NodeId } from "./ident";
import { inboundOf, type Adjacency, type Structure } from "./structure";

export interface CompileOptions<N = unknown, E = unknown> {
  /** 只保留满足谓词的节点。 */
  node?: (node: NodeId, weight: N | undefined) => boolean;
  /** 只保留满足谓词的边；两端节点也必须保留。 */
  edge?: (edge: Wire & { readonly weight: E | undefined }) => boolean;
  /** 把这些分组各折叠成单节点：其后代不再单独出现，跨组边聚合到组上、组内边消失。 */
  collapse?: Iterable<NodeId>;
  /**
   * 边权，只吃边自己的权重值。省略则不编译边权，最短路类算法将无法运行。
   *
   * @remarks 签名不给整条边，是为了让增量重编译只依赖权重值——改一个节点的参数因此
   *   不会牵动边权数组。要按端点算权就把它烘进 `E` 里。
   */
  weight?: (weight: E | undefined) => number;
  /**
   * 点权，只吃节点自己的权重值。省略则不编译点权，全部节点按 0 计。
   *
   * @remarks 与 {@link CompileOptions.weight} 对称，且两者各自独立作废：改边权不重算
   *   点权，改点权不重算边权。编排里节点自身的耗时走这条路——它摊不进边权（扇入大于 1
   *   时会被重复计数）。
   */
  cost?: (weight: N | undefined) => number;
  /** 视作无向：每条边在两端各出现一次。 */
  undirected?: boolean;
  /** 只编译出边方向，省掉一半内存与编译时间；{@link Snapshot.reverse} 与入向遍历将不可用。 */
  outbound?: boolean;
  /** 平行边合并为一条：权重两两经此函数聚合（如 `Math.min`），边 id 取首条。 */
  merge?: (a: number, b: number) => number;
  /**
   * 边上的分类标注，层名自取。CSR 只有拓扑，"这条边挂在哪个引脚上""这条边属于哪个分组"
   * 在索引空间本来是问不到的——不编译就只能拿边序号回 {@link Graph} 查一次字符串。
   *
   * @remarks 取值**intern 成整数**，全部层共用一张名字表（{@link Snapshot.words}）：
   *   热循环里比的是整数，跨线程搬的是 typed-array，表的长度是取值**种类数**而非边数，
   *   因此整层跟着 {@link Snapshot.core} 一起走，不像 O(V)/O(E) 的 id 标签那样要被裁掉。
   *
   *   回调收的是 {@link Wire} 而不是整条边记录——看不到权重，于是层只依赖结构，
   *   改权重时能整份复用。
   *
   * @example 端口层
   * ```ts
   * Snapshot.of(graph, {
   *   layer: { source: (wire) => wire.sourcePort, target: (wire) => wire.targetPort },
   * });
   * ```
   */
  layer?: Readonly<Record<string, (wire: Wire) => string>>;
  /** CSR 与权重分配在 `SharedArrayBuffer` 上，多个 Worker 可零拷贝共享；标签层不受影响。 */
  shared?: boolean;
  /**
   * 上一份快照。结构自它编译以来没变过就复用 CSR，只重算真正作废的那条权重数组；
   * 什么都没动则原样返回。编译选项不一致或用了谓词 / 折叠 / 合并时自动退回全量编译，
   * 因此传错不会出错，只是没有加速。
   */
  reuse?: Snapshot;
}

/** 快照的纯数据形态：只含 typed-array 与字符串数组，可结构化克隆或 transfer 给 Worker。 */
export interface SnapshotData {
  readonly graph: GraphId;
  readonly revision: number;
  readonly order: number;
  readonly size: number;
  /** 索引 → 节点 id；按 {@link Snapshot.core} 搬运时缺省。 */
  readonly nodes?: ReadonlyArray<NodeId> | undefined;
  /** 边序号 → 边 id；按 {@link Snapshot.core} 搬运时缺省。 */
  readonly edges?: ReadonlyArray<EdgeId> | undefined;
  readonly outbound: Adjacency;
  readonly inbound?: Adjacency | undefined;
  /** 边序号 → 边权。正反向共享一份。 */
  readonly weight?: Reals | undefined;
  /** 节点索引 → 点权。 */
  readonly cost?: Reals | undefined;
  /** 层名 → 边序号索引的编号数组，编号查 {@link SnapshotData.words}。 */
  readonly layers?: Readonly<Record<string, Ints>> | undefined;
  /** 编号 → 取值名，全部层共用。长度是取值种类数，因此随 {@link Snapshot.core} 一起搬运。 */
  readonly words?: ReadonlyArray<string> | undefined;
}

const NONE: ReadonlyArray<never> = [];
const BARE: Readonly<Record<string, Ints>> = {};

/** 名字 → 序号表的惰性容器；`reverse` 与增量重编译共享同一个，避免重复建表。 */
interface Lookup {
  nodes?: ReadonlyMap<NodeId, number>;
  words?: ReadonlyMap<string, number>;
}

/**
 * 不可变的图快照：CSR 邻接，全部数据在 typed-array 里，实现 {@link Structure}。
 *
 * 算法只吃 `Structure`，不吃 {@link Graph}——输入不可变意味着长跑任务中断后恢复时不会
 * 读到半改的图，也意味着快照能整份搬到 Worker 里跑。过滤、折叠、无向化都在编译期一次完成，
 * 因此运行期没有任何谓词回调或视图转发的开销。
 *
 * 这个类在 `Structure` 之上多出的只有**标签层**：索引 ↔ {@link NodeId} 的互查，以及
 * 可选的标注层（见 {@link CompileOptions.layer}）。算法产出的是索引，需要名字时在边界上用
 * {@link Snapshot.names} 换。
 */
export class Snapshot implements Structure {
  public readonly graph: GraphId;
  public readonly revision: number;
  public readonly order: number;
  public readonly size: number;
  /** 按 {@link Snapshot.core} 搬运过来的快照没有标签层，这里是空数组。 */
  public readonly nodes: ReadonlyArray<NodeId>;
  public readonly edges: ReadonlyArray<EdgeId>;
  public readonly outbound: Adjacency;
  public readonly inbound: Adjacency | undefined;
  public readonly weight: Reals | undefined;
  public readonly cost: Reals | undefined;
  /** 层名 → 边序号索引的编号数组；未编译标注层时为空。 */
  public readonly layers: Readonly<Record<string, Ints>>;
  /** 编号 → 取值名，全部层共用；未编译标注层时为空。 */
  public readonly words: ReadonlyArray<string>;

  /** 建表是惰性的：只跑索引空间算法的消费者（尤其是 Worker 侧）一次哈希都不用付。 */
  private readonly _lookup: Lookup;
  private readonly _source: Source | undefined;

  private constructor(data: SnapshotData, source?: Source, lookup?: Lookup) {
    this.graph = data.graph;
    this.revision = data.revision;
    this.order = data.order;
    this.size = data.size;
    this.nodes = data.nodes ?? NONE;
    this.edges = data.edges ?? NONE;
    this.outbound = data.outbound;
    this.inbound = data.inbound;
    this.weight = data.weight;
    this.cost = data.cost;
    this.layers = data.layers ?? BARE;
    this.words = data.words ?? NONE;
    this._lookup = lookup ?? {};
    this._source = source;
  }

  public indexOf(node: NodeId): number {
    const lookup = this._lookup;
    const map = (lookup.nodes ??= locate(this.nodes));
    return map.get(node) ?? -1;
  }

  /**
   * 取一层标注：边序号 → 编号。
   *
   * @throws `RangeError` 没编译过这一层——与"这条边没有标注"分得开
   */
  public layer(name: string): Ints {
    const found = this.layers[name];
    if (found === undefined) {
      throw new RangeError(`layer "${name}" was not compiled; pass it in \`layer\``);
    }
    return found;
  }

  /**
   * 取值名 → 编号；这张图里没出现过则为 -1。
   *
   * @remarks 分派分支时在循环外换一次编号，循环里就只剩整数比较——按名字逐边比字符串，
   *   在高扇出节点上是实打实的开销。名字表按需建，只跑纯拓扑算法的消费者不必付。
   */
  public code(word: string): number {
    const lookup = this._lookup;
    const map = (lookup.words ??= locate(this.words));
    return map.get(word) ?? -1;
  }

  /** 编号 → 取值名。@throws `RangeError` 编号越界 */
  public word(code: number): string {
    const found = this.words[code];
    if (found === undefined) {
      throw new RangeError(`layer code ${code} is out of range`);
    }
    return found;
  }

  /** 外部查询用：越界返回 `undefined`。 */
  public at(index: number): NodeId | undefined {
    return this.nodes[index];
  }

  /**
   * 内部遍历用：索引来自 `0 .. order-1`，越界属于程序错误而非查询失败。
   * 把这个不变量收在一处，调用点就不必到处写非空断言。
   */
  public node(index: number): NodeId {
    const found = this.nodes[index];
    if (found === undefined) {
      throw new RangeError(
        this.nodes.length === 0 && this.order > 0
          ? "snapshot was transferred without the label layer; send `data` instead of `core`"
          : `node index ${index} is out of range`,
      );
    }
    return found;
  }

  /** 批量把索引换成名字——算法产出与人看的东西之间的那道边界。 */
  public names(indices: Iterable<number>): NodeId[] {
    const found: NodeId[] = [];
    for (const index of indices) found.push(this.node(index));
    return found;
  }

  /**
   * 只含 CSR 与权重的搬运形态，不带标签层。
   *
   * @remarks 标签是字符串数组，结构化克隆时只能逐个深拷贝——V=5 万的快照里它占掉整份
   *   `data` 克隆耗时的九成（21ms → 1.9ms），而只跑索引空间算法的 Worker 侧根本用不到它。
   *   这样还原出来的快照 `at` / `indexOf` 查不到东西，`node` / `names` 明确报错。
   */
  public get core(): SnapshotData {
    return {
      graph: this.graph,
      revision: this.revision,
      order: this.order,
      size: this.size,
      outbound: this.outbound,
      inbound: this.inbound,
      weight: this.weight,
      cost: this.cost,
      // 标注层整体随 core 走：编号数组是 typed-array，名字表的长度是取值种类数，
      // 都不像 O(V)/O(E) 的 id 标签那样贵到需要裁掉。
      layers: this.layers === BARE ? undefined : this.layers,
      words: this.words === NONE ? undefined : this.words,
    };
  }

  /** 交给 `postMessage` 的纯数据；`Snapshot.from` 可在另一线程还原。 */
  public get data(): SnapshotData {
    // 按 core 还原的快照没有标签层。空数组要还原成"缺省"而不是原样带上，
    // 否则中转 Worker 转发它的 data 时会被 `Snapshot.from` 判作"0 个标签对 N 个节点"。
    return {
      ...this.core,
      nodes: this.nodes === NONE ? undefined : this.nodes,
      edges: this.edges === NONE ? undefined : this.edges,
    };
  }

  /**
   * 方向翻转，O(1)：底层数组与索引表全部共享，只是把出向与入向对调。
   *
   * @throws {@link Oneway} 编译时用了 `outbound` 因而没有入向邻接
   */
  public reverse(): Snapshot {
    const back = inboundOf(this, "Snapshot.reverse");
    const source = this._source;
    return new Snapshot(
      { ...this.data, outbound: back, inbound: this.outbound },
      source && { ...source, flipped: !source.flipped },
      this._lookup,
    );
  }

  /**
   * 源图自编译以来是否未再变更。跨线程还原的快照没有源图，源图已被回收时也无从判定，
   * 两种情况都恒为 `true`——陈旧只在**证据确凿**时才报。
   */
  public get current(): boolean {
    const source = this._source?.graph.deref();
    return source === undefined || source.revision === this.revision;
  }

  /** @throws {@link Stale} 源图已变更 */
  public verify(): this {
    const source = this._source?.graph.deref();
    if (source && source.revision !== this.revision) {
      throw new Stale(this.revision, source.revision);
    }
    return this;
  }

  /** @throws {@link Schema} 字段长度相互矛盾（截断或错位的搬运数据） */
  public static from(data: SnapshotData): Snapshot {
    conform(data);
    return new Snapshot(data);
  }

  public static of<N, E>(
    graph: Graph<N, E>,
    options: CompileOptions<N, E> = {},
  ): Snapshot {
    const recipe = recipeOf(options);
    const recycled = options.reuse?._recycle(graph, recipe, options);
    if (recycled) return recycled;
    const { data, source } = compile(graph, options, recipe);
    return new Snapshot(data, source);
  }

  /**
   * 增量重编译：结构没变就复用 CSR，只重算真正作废的那条权重数组；什么都没动则原样
   * 返回自己。改一个节点的参数因此不会牵动边权——那是编辑器里最频繁的一类变更。
   *
   * @returns 不满足复用条件时返回 `undefined`，由调用方走全量编译
   */
  private _recycle<N, E>(
    graph: Graph<N, E>,
    recipe: Recipe,
    options: CompileOptions<N, E>,
  ): Snapshot | undefined {
    const source = this._source;
    if (source === undefined) return undefined;
    // 源图已回收时 deref 给 undefined，同样不等于 graph，因此一并落到"不复用"。
    if (source.graph.deref() !== graph) return undefined;
    // 翻转过的快照方向与编译选项对不上，复用它会静默给出反向结构。
    if (source.flipped) return undefined;
    // 带谓词、折叠或合并时，结构不只由 shape 决定（谓词可能看权重），一律全量重来。
    if (!source.plain || !recipe.plain) return undefined;
    if (source.undirected !== recipe.undirected) return undefined;
    if (source.outbound !== recipe.outbound) return undefined;
    if (source.shared !== recipe.shared) return undefined;
    if (!sameLayers(source.layer, recipe.layer)) return undefined;
    if (source.shape !== graph.shape) return undefined;

    const weighed =
      recipe.weigh !== source.weigh || graph.weights !== source.weights;
    const priced =
      recipe.price !== source.price || graph.costs !== source.costs;
    // 任何变更都会推进两个计数器之一，因此两边都没动就等于图没动过。
    if (!weighed && !priced) return this;

    return new Snapshot(
      {
        ...this.data,
        revision: graph.revision,
        weight: weighed
          ? edgeWeights(
              graph,
              source.edges,
              source.edges.length,
              source.shared,
              options.weight,
            )
          : this.weight,
        cost: priced
          ? nodeCosts(
              graph,
              source.nodes,
              source.nodes.length,
              source.shared,
              options.cost,
            )
          : this.cost,
      },
      {
        ...source,
        revision: graph.revision,
        shape: graph.shape,
        weights: graph.weights,
        costs: graph.costs,
        weigh: recipe.weigh,
        price: recipe.price,
      },
      this._lookup,
    );
  }
}

/** @throws {@link Schema} 字段长度相互矛盾 */
function conform(data: SnapshotData): void {
  const { order, size, nodes, edges, weight, cost, layers, words } = data;
  fit(data.outbound, order, size, "outbound");
  const inbound = data.inbound;
  if (inbound !== undefined && inbound !== data.outbound) {
    fit(inbound, order, size, "inbound");
  }
  for (const [name, codes] of Object.entries(layers ?? {})) {
    bounded(codes, words, size, name);
  }
  if (weight !== undefined && weight.length !== size) {
    throw new Schema(`weight has ${weight.length} entries for ${size} edges`);
  }
  if (cost !== undefined && cost.length !== order) {
    throw new Schema(`cost has ${cost.length} entries for ${order} nodes`);
  }
  if (nodes !== undefined && nodes.length !== order) {
    throw new Schema(`${nodes.length} node ids for ${order} nodes`);
  }
  if (edges !== undefined && edges.length !== size) {
    throw new Schema(`${edges.length} edge ids for ${size} edges`);
  }
}

/**
 * 一个方向的邻接是否自洽。
 *
 * @remarks 长度对不代表内容对。错位或截断的搬运数据完全可能长度全中而下标越界，
 *   而越界的 `other[k]` 读出来是 `undefined`——比较、累加一路静默走下去，最后得到一个
 *   形状正常的错答案。这一遍是 O(E)，只在 {@link Snapshot.from} 还原时跑，
 *   编译出来的结构不必付。
 */
function fit(
  adjacency: Adjacency,
  order: number,
  size: number,
  side: string,
): void {
  const { offset, other, edge } = adjacency;
  if (offset.length !== order + 1) {
    throw new Schema(
      `${side} offset has ${offset.length} entries for ${order} nodes`,
    );
  }
  if (other.length !== edge.length || offset[order] !== other.length) {
    throw new Schema(
      `${side} lists ${other.length} slots but offset ends at ${offset[order]}`,
    );
  }
  if (offset[0] !== 0) {
    throw new Schema(`${side} offset starts at ${offset[0]}, not 0`);
  }
  for (let u = 0; u < order; u++) {
    if (offset[u + 1]! < offset[u]!) {
      throw new Schema(
        `${side} offset drops from ${offset[u]} to ${offset[u + 1]} at node ${u}`,
      );
    }
  }
  for (let k = 0; k < other.length; k++) {
    if (other[k]! < 0 || other[k]! >= order) {
      throw new Schema(
        `${side} slot ${k} points at node ${other[k]}, outside 0..${order - 1}`,
      );
    }
    if (edge[k]! < 0 || edge[k]! >= size) {
      throw new Schema(
        `${side} slot ${k} cites edge ${edge[k]}, outside 0..${size - 1}`,
      );
    }
  }
}

/** 一层标注的编号数组是否与名字表对得上。 */
function bounded(
  codes: Ints,
  words: ReadonlyArray<string> | undefined,
  size: number,
  name: string,
): void {
  if (codes.length !== size) {
    throw new Schema(
      `layer "${name}" has ${codes.length} entries for ${size} edges`,
    );
  }
  const width = words?.length ?? 0;
  for (let e = 0; e < size; e++) {
    if (codes[e]! < 0 || codes[e]! >= width) {
      throw new Schema(
        `layer "${name}"[${e}] is ${codes[e]} but only ${width} name(s) were sent`,
      );
    }
  }
}

function locate<K>(names: ReadonlyArray<K>): ReadonlyMap<K, number> {
  const index = new Map<K, number>();
  for (let i = 0; i < names.length; i++) index.set(names[i]!, i);
  return index;
}

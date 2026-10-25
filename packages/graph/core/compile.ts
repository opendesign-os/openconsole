/**
 * 可变 {@link Graph} → 不可变 CSR 的编译器。
 *
 * @remarks 契约（{@link Structure}）在 `./structure`，它不认识 Graph；成品容器
 *   （{@link Snapshot}）在 `./snapshot`，它不认识编译过程。两端之间的全部机器收在这里：
 *   折叠、过滤、平行边合并、标注层 intern、建 CSR，以及按版本号分档的增量复用。
 *
 * @packageDocumentation
 */

import { adjacency, flip, ints, reals, type Arcs } from "./array";
import { Invalid } from "./error";
import type { Graph } from "./graph";
import type { EdgeId, NodeId } from "./ident";
import { Interner } from "./slots";
import type { CompileOptions, SnapshotData } from "./snapshot";

/** 编译选项的指纹。整组一致才谈得上复用，因此作为一个值传递与比对。 */
export interface Recipe {
  /** 没用谓词、折叠或合并——只有这种编译的结构才由 `shape` 完全决定。 */
  readonly plain: boolean;
  readonly undirected: boolean;
  readonly outbound: boolean;
  readonly shared: boolean;
  /** 编译时的层回调集合，逐个按引用比对。 */
  readonly layer: Readonly<Record<string, unknown>>;
  /** 编译时的 `weight` 回调。引用变了说明语义可能已变，边权必须重算。 */
  readonly weigh: unknown;
  /** 编译时的 `cost` 回调，语义同 {@link Recipe.weigh}。 */
  readonly price: unknown;
}

/** 增量复用要比对的源图版本号。 */
interface Version {
  readonly revision: number;
  readonly shape: number;
  readonly weights: number;
  readonly costs: number;
}

/** 编译来源：配方指纹之上再记下是从哪张图的哪个版本编出来的。 */
export interface Source extends Recipe, Version {
  /**
   * 弱引用：快照可能活得比源图久（缓存在算法层、挂在 UI 状态上），强引用会把整张图连同
   * 全部端口对象一起钉住——快照自身可能只有几百 KB，钉住的图却是它的几十倍。
   */
  readonly graph: WeakRef<Version>;
  /** 出入向已被 {@link Snapshot.reverse} 对调过；这样的快照不能再拿去复用。 */
  readonly flipped: boolean;
  /** CSR 节点索引 → 图内节点槽位。结构不变时槽位不动，据此可零哈希地重算点权。 */
  readonly nodes: Int32Array;
  /** CSR 边序号 → 图内边槽位，语义同 {@link Source.nodes}。 */
  readonly edges: Int32Array;
}

export interface Compiled {
  readonly data: SnapshotData;
  readonly source: Source;
}

/**
 * 编译中的边表：{@link Arcs} 再带一条回图内槽位的映射。
 *
 * @remarks 这四样在编译里始终同进同出——合并平行边会一起收缩，建 CSR 要一起读——摊成
 *   四个位置参数一路传下去，等于把一个概念拆成四份让每个调用点重新拼一遍。`readonly`
 *   锁的是字段不是内容：合并就地改写数组，与 CSR 的构造期写入同一口径。
 */
interface Links extends Arcs {
  /** 边序号 → 图内边槽位。 */
  readonly slots: Int32Array;
}

export function recipeOf<N, E>(options: CompileOptions<N, E>): Recipe {
  return {
    plain:
      options.node === undefined &&
      options.edge === undefined &&
      options.merge === undefined &&
      options.collapse === undefined,
    undirected: options.undirected === true,
    outbound: options.outbound === true,
    shared: options.shared === true,
    layer: options.layer ?? {},
    weigh: options.weight,
    price: options.cost,
  };
}

/** 两次编译的层集合是否一致——层名与回调引用都要对得上。 */
export function sameLayers(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): boolean {
  const names = Object.keys(left);
  if (names.length !== Object.keys(right).length) return false;
  return names.every((name) => left[name] === right[name]);
}

export function compile<N, E>(
  graph: Graph<N, E>,
  options: CompileOptions<N, E>,
  recipe: Recipe,
): Compiled {
  const { undirected, shared } = recipe;

  const represent = folding(graph, options.collapse);
  const place = new Int32Array(graph.bound).fill(-1);
  const homes = new Int32Array(graph.bound);
  const labels: NodeId[] = [];
  graph.forEachNode((id, weight, slot) => {
    if (represent(slot) !== slot) return;
    if (options.node?.(id, weight) === false) return;
    const at = labels.length;
    place[slot] = at;
    homes[at] = slot;
    labels.push(id);
  });
  const order = labels.length;
  const nodes = homes.slice(0, order);

  const capacity = graph.size;
  const tail = new Int32Array(capacity);
  const head = new Int32Array(capacity);
  const slots = new Int32Array(capacity);
  const keep = options.edge;
  let found = 0;

  // 落位写成裸循环、计数留在局部变量上：这是整个编译里最热的一段，换成结构体字段
  // 等于每条边多一次属性读写。边表在循环之后才成形。
  graph.forEachLink((e, from, to) => {
    const source = represent(from);
    const target = represent(to);
    const u = place[source]!;
    const v = place[target]!;
    if (u < 0 || v < 0) return;
    // 组内边随折叠一起消失；未被折叠的真自环保留。
    if (u === v && (source !== from || target !== to)) return;
    if (keep !== undefined && keep(graph.edgeAt(e)!) === false) return;
    tail[found] = u;
    head[found] = v;
    slots[found] = e;
    found++;
  });

  let links: Links = { tail, head, slots, count: found };
  let weight = edgeWeights(graph, slots, found, shared, options.weight);
  if (options.merge !== undefined) {
    links = coalesce(links, order, undirected, weight, options.merge);
    if (weight !== undefined) {
      // 聚合能从有限值造出 NaN（如 Infinity 相消），与 `edgeWeights` 同一道关，在源头拦。
      for (let i = 0; i < links.count; i++) {
        if (Number.isNaN(weight[i])) {
          throw new Invalid(graph.edgeIdAt(links.slots[i]!)!);
        }
      }
      // 合并后长度缩水，裁一份紧的，快照不拖超配的尾巴。
      const packed = reals(links.count, shared);
      packed.set(weight.subarray(0, links.count));
      weight = packed;
    }
  }

  const size = links.count;
  const edges = links.slots.slice(0, size);
  const names = Object.keys(recipe.layer);
  const words = names.length > 0 ? new Interner() : undefined;
  const reads = names.map((name) => options.layer![name]!);
  const columns = names.map(() => ints(size, shared));

  // 边 id 与标注层共用这一趟：`edges` 此时已是合并后的紧凑序，逐个回查即可。
  const ids: EdgeId[] = new Array(size);
  for (let i = 0; i < size; i++) {
    const slot = edges[i]!;
    ids[i] = graph.edgeIdAt(slot)!;
    if (words !== undefined) {
      // 一条边只物化一次接线，全部层共用；没有层时连这一次都不付。
      const wire = graph.edgeAt(slot)!;
      for (let c = 0; c < reads.length; c++) {
        columns[c]![i] = words.of(reads[c]!(wire));
      }
    }
  }
  const layers: Record<string, Int32Array> = {};
  names.forEach((name, c) => {
    layers[name] = columns[c]!;
  });

  const outbound = adjacency(order, links, undirected, shared);
  const inbound = recipe.outbound
    ? undefined
    : undirected
      ? outbound
      : adjacency(order, flip(links), false, shared);

  return {
    data: {
      graph: graph.id,
      revision: graph.revision,
      order,
      size,
      nodes: labels,
      edges: ids,
      outbound,
      inbound,
      weight,
      cost: nodeCosts(graph, nodes, order, shared, options.cost),
      layers,
      words: words?.table,
    },
    source: {
      ...recipe,
      graph: new WeakRef(graph),
      revision: graph.revision,
      shape: graph.shape,
      weights: graph.weights,
      costs: graph.costs,
      flipped: false,
      nodes,
      edges,
    },
  };
}

/**
 * 按槽位逐个求值，落进一条紧凑的权重数组。
 *
 * @throws {@link Invalid} 回调给出了 `NaN`——在这里拦才报得出 id，漏到算法里就只剩序号
 */
function appraise(
  slots: Int32Array,
  count: number,
  shared: boolean,
  value: (slot: number) => number,
  blame: (slot: number) => string,
): Float64Array {
  const found = reals(count, shared);
  for (let i = 0; i < count; i++) {
    const slot = slots[i]!;
    const cost = value(slot);
    if (Number.isNaN(cost)) throw new Invalid(blame(slot));
    found[i] = cost;
  }
  return found;
}

/**
 * 边权：按边槽位求值。结构不变时槽位不动，因此增量重编译走的是同一条路——
 * 一遍纯下标扫描，不经 id 查表。
 */
export const edgeWeights = <N, E>(
  graph: Graph<N, E>,
  slots: Int32Array,
  count: number,
  shared: boolean,
  weigh: ((weight: E | undefined) => number) | undefined,
): Float64Array | undefined =>
  weigh &&
  appraise(
    slots,
    count,
    shared,
    (slot) => weigh(graph.edgeWeightAt(slot)),
    (slot) => graph.edgeIdAt(slot)!,
  );

/** 点权：按节点槽位求值，语义同 {@link edgeWeights}。 */
export const nodeCosts = <N, E>(
  graph: Graph<N, E>,
  slots: Int32Array,
  count: number,
  shared: boolean,
  price: ((weight: N | undefined) => number) | undefined,
): Float64Array | undefined =>
  price &&
  appraise(
    slots,
    count,
    shared,
    (slot) => price(graph.nodeWeightAt(slot)),
    (slot) => graph.nodeIdAt(slot)!,
  );

/** 平行边就地去重：首条留位，其余的权重经 `merge` 折进首条。 */
function coalesce(
  links: Links,
  order: number,
  undirected: boolean,
  weight: Float64Array | undefined,
  merge: (a: number, b: number) => number,
): Links {
  const { tail, head, slots, count } = links;
  const seen = new Map<number, number>();
  let kept = 0;
  for (let i = 0; i < count; i++) {
    let u = tail[i]!;
    let v = head[i]!;
    if (undirected && v < u) {
      const swap = u;
      u = v;
      v = swap;
    }
    // order < 2²⁶ 时 u·order+v 不超过 2⁵³，键精确；标签层远在那个规模前就先耗尽内存了。
    const key = u * order + v;
    const at = seen.get(key);
    if (at === undefined) {
      seen.set(key, kept);
      tail[kept] = tail[i]!;
      head[kept] = head[i]!;
      slots[kept] = slots[i]!;
      if (weight !== undefined) weight[kept] = weight[i]!;
      kept++;
    } else if (weight !== undefined) {
      weight[at] = merge(weight[at]!, weight[i]!);
    }
  }
  return { ...links, count: kept };
}

/** 节点槽位 → 代表节点槽位：祖先中最外层的被折叠分组，没有则是自身。 */
function folding<N, E>(
  graph: Graph<N, E>,
  groups: Iterable<NodeId> | undefined,
): (slot: number) => number {
  const collapsed = new Set<number>();
  for (const id of groups ?? []) {
    const u = graph.indexOf(id);
    if (u >= 0) collapsed.add(u);
  }
  if (collapsed.size === 0) return (slot) => slot;

  const cache = new Int32Array(graph.bound).fill(-1);
  return (slot: number): number => {
    const known = cache[slot]!;
    if (known >= 0) return known;
    let representative = slot;
    for (
      let cursor = graph.parentAt(slot);
      cursor !== -1;
      cursor = graph.parentAt(cursor)
    ) {
      if (collapsed.has(cursor)) representative = cursor;
    }
    cache[slot] = representative;
    return representative;
  };
}

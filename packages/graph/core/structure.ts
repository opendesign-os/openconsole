/**
 * **算法的输入契约**及其派生量。
 *
 * @remarks 这个模块刻意不认识 {@link Graph}：算法面向 {@link Structure} 而不是
 *   {@link Snapshot} 类，是这个包的核心主张，而主张要靠依赖方向坐实——契约与"从可变图
 *   编译 CSR"的机器放在同一个文件里，算法层就会为了取一个类型把整个编辑层拖进传递依赖，
 *   "凑得出五个字段就能跑"也就只剩一句注释。编译器在 `./snapshot`。
 *
 * @packageDocumentation
 */

import { adjacency, flip, reals, type Arcs, type Ints, type Reals } from "./array";
import { Invalid, Oneway, Oversized } from "./error";

/**
 * 一个方向的 CSR 邻接。三条数组绑在一个对象里，因此"有没有入向"是一次判断，
 * 而不是三个各自可空的字段。
 */
export interface Adjacency {
  /** 长度 `order+1`；节点 `u` 的邻接槽区间是 `[offset[u], offset[u+1])`。 */
  readonly offset: Ints;
  /** 槽 → 对端节点索引：出向里是目标，入向里是来源。 */
  readonly other: Ints;
  /** 槽 → 边序号，用于查 {@link Structure.weight}。 */
  readonly edge: Ints;
}

/**
 * **算法的输入契约**：索引空间的邻接读取，六个只读字段，全是纯数据。
 *
 * 算法一律面向这个接口而不是 {@link Snapshot} 类，因此凡是能凑出这六个字段的东西都能
 * 直接跑全套算法——SharedArrayBuffer 背书的邻接、WASM 里导出的 CSR、按规则生成而非
 * 存储的图、别的库编译出的结果，都不必先塞进 `Graph` 再编译一遍。
 *
 * @example 手写一条 3 节点链，不经过 Graph
 * ```ts
 * const chain: Structure = {
 *   order: 3,
 *   size: 2,
 *   outbound: { offset: Int32Array.of(0, 1, 2, 2), other: Int32Array.of(1, 2), edge: Int32Array.of(0, 1) },
 *   inbound: { offset: Int32Array.of(0, 0, 1, 2), other: Int32Array.of(0, 1), edge: Int32Array.of(0, 1) },
 *   weight: Float64Array.of(3, 4),
 *   cost: undefined,
 * };
 * settle(toposort(chain)); // Int32Array [0, 1, 2]
 * ```
 */
export interface Structure {
  readonly order: number;
  readonly size: number;
  readonly outbound: Adjacency;
  /** 没有入向邻接时为 `undefined`；与 `outbound` 同一个对象则表示按无向编译。 */
  readonly inbound: Adjacency | undefined;
  /** 边序号 → 边权；`undefined` 表示无边权，全部边按 1 计。 */
  readonly weight: Reals | undefined;
  /**
   * 节点索引 → 点权；`undefined` 表示无点权，全部节点按 0 计。
   *
   * @remarks 节点自身的代价摊不进边权——扇入大于 1 时会被重复计数——所以它要自己一条
   *   数组。编排 DAG 的关键路径（节点有执行耗时）、带点权的调度与覆盖问题都用它。
   */
  readonly cost: Reals | undefined;
}

/** 边序号对应的边权；未编译边权时恒为 1。热循环里请把 `weight` 提到循环外直读。 */
export const weightOf = (structure: Structure, edge: number): number =>
  structure.weight ? structure.weight[edge]! : 1;

/** 节点索引对应的点权；未编译点权时恒为 0。 */
export const costOf = (structure: Structure, node: number): number =>
  structure.cost ? structure.cost[node]! : 0;

/** 入向与出向是同一份邻接（无向编译），把它当无向图看时无需再扫反向。 */
export const merged = (structure: Structure): boolean =>
  structure.inbound === structure.outbound;

/**
 * 取入向邻接，缺失即报错——凡是真需要反向邻接的入口都先过这道关，别各自静默降级。
 *
 * @throws {@link Oneway} 结构只编了出向
 */
export function inboundOf(structure: Structure, caller: string): Adjacency {
  const found = structure.inbound;
  if (!found) throw new Oneway(caller);
  return found;
}

/**
 * 无向视角下需要额外扫的那一侧邻接。
 *
 * @remarks 与 {@link inboundOf} 的区别在于**无向编译时返回 `undefined`**：那种结构里
 *   两个方向是同一个对象，再扫一遍等于把每条边数两次。生成树、弱连通、割点都用它。
 *
 * @throws {@link Oneway} 结构只编了出向——这三者都是无向概念，缺入向不会报错，
 *   而是静默漏掉整个分支
 */
export const mirror = (
  structure: Structure,
  caller: string,
): Adjacency | undefined =>
  merged(structure) ? undefined : inboundOf(structure, caller);

/**
 * 方向翻转的视图，O(1)：底层数组全部共享，只是把出向与入向对调。
 *
 * @throws {@link Oneway} 没有入向邻接
 */
export function reversed(structure: Structure): Structure {
  const back = inboundOf(structure, "reversed");
  return {
    order: structure.order,
    size: structure.size,
    outbound: back,
    inbound: structure.outbound,
    weight: structure.weight,
    cost: structure.cost,
  };
}

/**
 * 索引子集视图：只保留 `keep` 里的节点，以及两端都在其中的边。
 *
 * 产出活在**子集索引空间**里：子集节点 `i` 对应原结构的 `keep[i]`，子集边序号 `e` 对应
 * {@link Subset.edges}`[e]`；边权与点权都已按新序号重排，因此它就是个普通 {@link Structure}，
 * 全套算法照常跑。
 *
 * @remarks 这是"契约是接口而不是类"的红利：凑出六个字段就是一个合法结构，不必回
 *   {@link Graph} 重编一份快照。构造是 O(保留规模)，而编译一份过滤快照是 O(V+E)——
 *   按分组逐个算时差一个数量级。无向结构里一条边在两端各出现一次，这里按原边序号去重。
 *
 * @example 只看某个分组内部的拓扑序
 * ```ts
 * const inside = subset(snapshot, Int32Array.from(members));
 * snapshot.names(settle(toposort(inside)).map((i) => members[i]));
 * ```
 */
export interface Subset extends Structure {
  /** 子集边序号 → 原结构的边序号；回查边 id 用。 */
  readonly edges: Ints;
}

export function subset(structure: Structure, keep: Ints): Subset {
  const order = keep.length;
  const place = new Int32Array(structure.order).fill(-1);
  for (let i = 0; i < order; i++) place[keep[i]!] = i;

  const out = structure.outbound;
  const undirected = merged(structure);
  // 无向结构的一条边在两端各出现一次，只认首次遇到的那次。
  const taken = undirected ? new Uint8Array(structure.size) : undefined;
  const tail: number[] = [];
  const head: number[] = [];
  const origin: number[] = [];

  for (let i = 0; i < order; i++) {
    const u = keep[i]!;
    for (let k = out.offset[u]!; k < out.offset[u + 1]!; k++) {
      const v = place[out.other[k]!]!;
      if (v < 0) continue;
      const e = out.edge[k]!;
      if (taken !== undefined) {
        if (taken[e] === 1) continue;
        taken[e] = 1;
      }
      tail.push(i);
      head.push(v);
      origin.push(e);
    }
  }

  const arcs: Arcs = {
    tail: Int32Array.from(tail),
    head: Int32Array.from(head),
    count: origin.length,
  };
  const outbound = adjacency(order, arcs, undirected);
  const edges = Int32Array.from(origin);
  return {
    order,
    size: arcs.count,
    outbound,
    inbound:
      structure.inbound === undefined
        ? undefined
        : undirected
          ? outbound
          : adjacency(order, flip(arcs), false),
    weight: select(structure.weight, edges),
    cost: select(structure.cost, keep),
    edges,
  };
}

/** 按索引数组挑出一份新的实数数组。 */
const select = (from: Reals | undefined, index: Ints): Reals | undefined => {
  if (from === undefined) return undefined;
  const found = reals(index.length);
  for (let i = 0; i < index.length; i++) found[i] = from[index[i]!]!;
  return found;
};

export const outDegree = (structure: Structure, u: number): number =>
  structure.outbound.offset[u + 1]! - structure.outbound.offset[u]!;

/** 缺入向邻接时恒为 0；需要报错而非降级的场合用 {@link inboundOf}。 */
export const inDegree = (structure: Structure, u: number): number => {
  const inbound = structure.inbound;
  return inbound ? inbound.offset[u + 1]! - inbound.offset[u]! : 0;
};

/**
 * `u` 的后继，直接切 CSR 返回底层数组的**视图**。
 *
 * @remarks 不复制、不为每个节点分配数组——物化全图就是 V 个对象加 2V 个数组，而绝大多数
 *   调用只会看其中几个节点。视图在类型上只读（{@link Ints}），改不动底下的快照。
 */
export function successors(structure: Structure, u: number): Ints {
  const { offset, other } = structure.outbound;
  return other.subarray(offset[u]!, offset[u + 1]!);
}

/**
 * `u` 的前驱，语义同 {@link successors}。
 *
 * @throws {@link Oneway} 结构只编了出向——给空数组就等于谎报"没有前驱"
 */
export function predecessors(structure: Structure, u: number): Ints {
  const back = inboundOf(structure, "predecessors");
  return back.other.subarray(back.offset[u]!, back.offset[u + 1]!);
}

/** 稠密结构的默认内存上限：512MB。 */
export const CEILING = 512 * 1024 * 1024;

export interface DenseOptions {
  /** O(V²) 分配的字节上限，默认 {@link CEILING}；超出抛 {@link Oversized}。 */
  limit?: number;
}

/**
 * 稠密分配前的规模闸门。
 *
 * @throws {@link Oversized} 超过 `limit`
 */
export function afford(bytes: number, limit: number, what: string): void {
  if (bytes > limit) throw new Oversized(bytes, limit, what);
}

/** 边权画像：一遍 O(E) 扫描能得出的全部结论。 */
export interface Profile {
  /** 全部边权都是非负整数——桶队列的前提。 */
  readonly integral: boolean;
  readonly max: number;
  /** 首条负权边的序号；没有负权为 -1。 */
  readonly negative: number;
}

const UNWEIGHTED: Profile = { integral: true, max: 1, negative: -1 };

/**
 * 边权画像的记忆表。
 *
 * @remarks 画像是**不可变结构**的属性，只该算一次：不缓存的话，在 V=5000 / E=40000 上
 *   这一遍扫描要占单次 Dijkstra 的 17%，多源场景更是白付一个 O(V·E)。记在 `WeakMap` 上
 *   而不是 {@link Snapshot} 字段上，是为了让自定义 {@link Structure} 实现同样享受到。
 *
 *   键取**权重数组**而不是结构：{@link reversed} / {@link Snapshot.reverse} 每次都产出新的
 *   结构对象却共享同一份权重，以结构为键的话反向搜索每跑一次就要重扫一遍全部边权。
 *
 *   前提是权重数组不被就地改写——{@link Reals} 在类型上只读，{@link Snapshot} 也从不复用它：
 *   增量重编译产出的是新数组、新实例，因此不会读到过期画像。
 */
const profiles = new WeakMap<Reals | Structure, Profile>();

/**
 * 边权画像，按权重数组记忆化。
 *
 * @throws {@link Invalid} 存在 `NaN` 权边——这一遍本来就要走完，顺手拦下是零成本
 */
export function profileOf(structure: Structure): Profile {
  const weight = structure.weight;
  // 无权结构没有可共享的数组，退回以结构本身为键。
  const key = weight ?? structure;
  const known = profiles.get(key);
  if (known) return known;
  if (weight === undefined) return UNWEIGHTED;

  let integral = true;
  let max = 0;
  let negative = -1;
  for (let e = 0; e < weight.length; e++) {
    const cost = weight[e]!;
    if (Number.isNaN(cost)) throw new Invalid(e);
    if (cost < 0 && negative < 0) negative = e;
    if (integral && !Number.isInteger(cost)) integral = false;
    if (cost > max) max = cost;
  }
  const found: Profile = { integral, max, negative };
  profiles.set(key, found);
  return found;
}

/**
 * 校验过的边权数组；`undefined` 表示无权，全部边按 1 计。
 *
 * @remarks 跑遍全图的算法用它在**入口处一次性**验掉 `NaN`，内层循环因此不必逐边再判——
 *   Bellman-Ford 会把每条边看 V 遍，那个分支省下来是实打实的。提前终止型的搜索
 *   （A\*、双向）刻意不走这条路：它们的卖点就是只探索一小片图，预扫全部边权往往比
 *   实际访问到的边还多。
 *
 * @throws {@link Invalid} 存在 `NaN` 权边
 */
export function weights(structure: Structure): Reals | undefined {
  profileOf(structure);
  return structure.weight;
}

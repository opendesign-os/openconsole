/**
 * 复合层级：父子关系的存储本体，以及它的派生查询。
 *
 * @remarks 层级只存在于可变 {@link Graph} 上——它不进 CSR，因此也进不了
 *   {@link Structure}。派生查询放在 `./algorithm` 里会成为算法层唯一一处反向依赖编辑层
 *   的地方；摆在编辑层这一侧，`./algorithm` 就能守住"只认索引空间"的边界。
 *
 *   三个查询都按 `<N, E>` 泛型收图而不是写死 `Graph`（即 `Graph<unknown, unknown>`）：
 *   图的事件总线在类型上是**不变**的，写死就等于只接受 `Graph<unknown, unknown>`，
 *   任何具体类型的图都传不进来。
 *
 * @packageDocumentation
 */

import type { Graph } from "./graph";
import type { NodeId } from "./ident";
import { gather, remap, unhook } from "./slots";

const EMPTY: ReadonlyArray<number> = [];

/**
 * 父子关系的存储：三条按节点槽位索引的平行数组。
 *
 * @remarks 与邻接完全正交——不参与端口校验、不参与边的摘链、不进 CSR——所以从
 *   {@link Graph} 里单拎出来。它只认槽位，不认 id，也不认事件：变更前后的父节点交还给
 *   调用方，由它去派发 `parentChanged`。
 */
export class Hierarchy {
  private readonly _parent: number[] = [];
  private readonly _children: Array<number[] | undefined> = [];
  /** 节点在父节点子表里的下标，摘链时同步维护，见 {@link unhook}。 */
  private readonly _at: number[] = [];

  /** 登记一个新槽位；槽位会被回收复用，因此每次都要重置。 */
  public open(u: number): void {
    this._parent[u] = -1;
    this._children[u] = undefined;
    this._at[u] = -1;
  }

  /** 父节点槽位；顶层或空位为 -1。 */
  public parent(u: number): number {
    return this._parent[u] ?? -1;
  }

  public children(u: number): ReadonlyArray<number> {
    return this._children[u] ?? EMPTY;
  }

  /** `u` 是否在 `node` 的祖先链上（含 `node` 自身）——挂载前的环检测。 */
  public above(u: number, node: number): boolean {
    for (let cursor = node; cursor !== -1; cursor = this._parent[cursor]!) {
      if (cursor === u) return true;
    }
    return false;
  }

  /** 改挂到 `parent` 下，`-1` 表示提到顶层。是否真的变了由调用方先判。 */
  public attach(u: number, parent: number): void {
    this.detach(u);
    this._parent[u] = parent;
    if (parent !== -1) {
      this._at[u] = (this._children[parent] ??= []).push(u) - 1;
    }
  }

  /** 从父节点的子表里摘掉，成为顶层。 */
  public detach(u: number): void {
    const parent = this._parent[u]!;
    this._parent[u] = -1;
    if (parent === -1) return;
    const siblings = this._children[parent];
    if (siblings) unhook(siblings, this._at, u);
  }

  /**
   * 删节点时整表摘走子表并交还。
   *
   * @remarks 整表随节点一起丢弃，调用方逐个改挂时 {@link Hierarchy.detach} 因此不会在
   *   **正被迭代的数组**上做 swap-pop——那样会把补位到已访问下标的子节点整个漏掉。
   */
  public orphan(u: number): ReadonlyArray<number> {
    const children = this._children[u];
    this._children[u] = undefined;
    return children ?? EMPTY;
  }

  /** 按 {@link Slots.compact} 的映射重排。 */
  public compact(remapping: Int32Array, order: number): void {
    gather(this._parent, remapping, order);
    gather(this._children, remapping, order);
    gather(this._at, remapping, order);
    for (let u = 0; u < order; u++) {
      const parent = this._parent[u]!;
      this._parent[u] = parent === -1 ? -1 : remapping[parent]!;
      const children = this._children[u];
      if (children) remap(children, remapping);
    }
  }
}

/** 没有父节点的顶层节点。 */
export function roots<N, E>(graph: Graph<N, E>): NodeId[] {
  return graph.nodes().filter((node) => graph.parent(node) === undefined);
}

/** 以 `root` 为根的子树全部节点，含自身。 */
export function subtree<N, E>(graph: Graph<N, E>, root: NodeId): NodeId[] {
  const found: NodeId[] = [];
  const stack: NodeId[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    found.push(node);
    // 不用 spread：实参个数有引擎上限，特别宽的分组会直接 RangeError。
    for (const child of graph.children(node)) stack.push(child);
  }
  return found;
}

/** 自底向上的祖先链，不含自身。 */
export function ancestry<N, E>(graph: Graph<N, E>, node: NodeId): NodeId[] {
  const chain: NodeId[] = [];
  for (
    let cursor = graph.parent(node);
    cursor !== undefined;
    cursor = graph.parent(cursor)
  ) {
    chain.push(cursor);
  }
  return chain;
}

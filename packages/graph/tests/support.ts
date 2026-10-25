import {
  Graph,
  graphId,
  nodeId,
  Snapshot,
  Socket,
  Vertex,
  type EdgeId,
  type NodeId,
  type Sockets,
} from "../index";

/** 确定性伪随机：同一 seed 永远给出同一张图，失败用例可直接复现。 */
export class Rng {
  public constructor(private _state: number) {
    this._state = _state | 0 || 1;
  }

  public next(): number {
    this._state = (this._state * 1103515245 + 12345) & 0x7fffffff;
    return this._state;
  }

  public int(bound: number): number {
    return bound <= 0 ? 0 : this.next() % bound;
  }
}

/** 带一对通配端口的节点模板；测试里绝大多数场景只需要这个形状。 */
export const vertex = <W>(
  name: string,
  weight?: W,
): Vertex<Sockets, Sockets, W> =>
  new Vertex<Sockets, Sockets, W>(nodeId(name), weight)
    .addInput("in", Socket.any)
    .addOutput("out", Socket.any);

export const cost = (weight: number | undefined): number => weight ?? 1;

export const weighted = (graph: Graph<number, number>): Snapshot =>
  Snapshot.of(graph, { weight: cost });

export interface Shape {
  order?: number;
  /** 每个节点的平均出边数。 */
  density?: number;
  /** 只连 i → j (j > i)，因此保证无环。 */
  acyclic?: boolean;
  weights?: "none" | "integer" | "real";
  loops?: boolean;
}

export function randomGraph(
  seed: number,
  shape: Shape = {},
): Graph<number, number> {
  const {
    order = 20,
    density = 2,
    acyclic = false,
    weights = "integer",
    loops = false,
  } = shape;
  const rng = new Rng(seed);
  const graph = new Graph<number, number>(graphId(`seed-${seed}`));

  for (let i = 0; i < order; i++) graph.addNode(vertex(`n${i}`, i));

  const weigh = (): number | undefined => {
    if (weights === "none") return undefined;
    return weights === "integer" ? rng.int(9) + 1 : (rng.int(900) + 100) / 100;
  };

  for (let i = 0; i < order; i++) {
    for (let k = 0; k < density; k++) {
      const j = acyclic
        ? i + 1 + rng.int(Math.max(1, order - i - 1))
        : rng.int(order);
      if (j >= order) continue;
      if (i === j && !loops) continue;
      graph.connect([nodeId(`n${i}`), "out"], [nodeId(`n${j}`), "in"], {
        weight: weigh(),
      });
    }
  }
  return graph;
}

/**
 * 无标度图（Barabási–Albert 偏好连接）：新节点以一半概率均匀选边、一半概率按度数选边。
 * 低直径、重尾度分布——社交网络形状，前沿会在几层内膨胀到覆盖大半个图。
 */
export function scaleFree(
  seed: number,
  order = 20,
  degree = 2,
): Graph<number, number> {
  const rng = new Rng(seed);
  const graph = new Graph<number, number>(graphId(`scale-${seed}`));
  for (let i = 0; i < order; i++) graph.addNode(vertex(`n${i}`, i));

  const ends: number[] = [];
  for (let i = 1; i < order; i++) {
    const stubs = Math.min(degree, i);
    for (let k = 0; k < stubs; k++) {
      const j =
        ends.length === 0 || rng.int(2) === 0
          ? rng.int(i)
          : ends[rng.int(ends.length)]!;
      graph.connect([nodeId(`n${i}`), "out"], [nodeId(`n${j}`), "in"], {
        weight: rng.int(9) + 1,
      });
      ends.push(i, j);
    }
  }
  return graph;
}

/** 一个中心节点扇出 `fan` 条边；用来把删边路径的复杂度逼出来。 */
export function hub(fan: number): Graph<number, number> {
  const graph = new Graph<number, number>(graphId("hub"));
  graph.addNode(vertex("h", 0));
  for (let i = 0; i < fan; i++) {
    graph.addNode(vertex(`n${i}`, i));
    graph.connect([nodeId("h"), "out"], [nodeId(`n${i}`), "in"], { weight: 1 });
  }
  return graph;
}

/**
 * `a → c ← b`。
 *
 * @remarks 无向看是一棵树，只编出向就散成两块——凡是"缺入向会静默给错答案"的断言
 *   都拿这个形状做样本。
 */
export function wedge(): Graph<number, number> {
  const graph = new Graph<number, number>(graphId("wedge"));
  for (const name of ["a", "b", "c"]) graph.addNode(vertex(name, 0));
  graph.connect([nodeId("a"), "out"], [nodeId("c"), "in"], { weight: 1 });
  graph.connect([nodeId("b"), "out"], [nodeId("c"), "in"], { weight: 2 });
  return graph;
}

/** `n0 → n1 → … → n{links}`，权重各不相同。 */
export function line(links: number): Graph<number, number> {
  const graph = new Graph<number, number>(graphId("line"));
  for (let i = 0; i <= links; i++) graph.addNode(vertex(`n${i}`, i));
  for (let i = 0; i < links; i++) {
    graph.connect([nodeId(`n${i}`), "out"], [nodeId(`n${i + 1}`), "in"], {
      weight: ((i * 7919) % 97) + 1,
    });
  }
  return graph;
}

/** 无向边的规范化标识，便于与朴素实现比对。 */
export const undirectedKey = (a: NodeId, b: NodeId): string =>
  a < b ? `${a}|${b}` : `${b}|${a}`;

export const edgeKey = (graph: Graph<number, number>, edge: EdgeId): string => {
  const record = graph.edge(edge)!;
  return undirectedKey(record.source, record.target);
};

/** 索引空间的分组换回 id 再规范化，便于与朴素实现对拍。 */
export const groupKeys = (
  snapshot: Snapshot,
  groups: Array<Iterable<number>>,
): string[] =>
  groups.map((group) => snapshot.names(group).sort().join(",")).sort();

export const setKeys = (groups: Set<string>[]): string[] =>
  groups.map((group) => [...group].sort().join(",")).sort();

/** 快照里某节点的出邻居，按名字排序。 */
export function outOf(snapshot: Snapshot, node: NodeId): NodeId[] {
  const u = snapshot.indexOf(node);
  const { offset, other } = snapshot.outbound;
  const found: NodeId[] = [];
  for (let k = offset[u]!; k < offset[u + 1]!; k++) {
    found.push(snapshot.node(other[k]!));
  }
  return found.sort();
}

export function segments(path: NodeId[]): Array<[NodeId, NodeId]> {
  const listed: Array<[NodeId, NodeId]> = [];
  for (let i = 0; i + 1 < path.length; i++) {
    listed.push([path[i]!, path[i + 1]!]);
  }
  return listed;
}

/** 沿路径把每段最轻的平行边加起来。 */
export const walked = (graph: Graph<number, number>, path: NodeId[]): number =>
  segments(path).reduce(
    (total, [from, to]) =>
      total +
      Math.min(...graph.between(from, to).map((e) => graph.edgeWeight(e) ?? 1)),
    0,
  );

/** 取多轮里最快的一轮：慢的那些轮混进的是调度噪声，不是被测代码。 */
export function fastest(runs: number, work: () => void): number {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    work();
    const spent = performance.now() - started;
    if (spent < best) best = spent;
  }
  return best;
}

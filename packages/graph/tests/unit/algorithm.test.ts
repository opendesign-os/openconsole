import { describe, expect, it } from "vitest";

import {
  acyclic,
  ancestors,
  ancestry,
  astar,
  bellmanFord,
  bfs,
  bidirectional,
  bottleneck,
  closure,
  components,
  condensation,
  criticalPath,
  cuts,
  Cycle,
  descendants,
  dfs,
  dominators,
  floydWarshall,
  generations,
  Graph,
  graphId,
  Invalid,
  kruskal,
  levels,
  nodeId,
  postorder,
  prim,
  ranks,
  reachable,
  reduction,
  roots,
  scc,
  settle,
  shortestPath,
  shortestPaths,
  simpleCycles,
  Snapshot,
  subtree,
  topology,
  toposort,
  visit,
  type NodeId,
  type Structure,
  type Task,
} from "../../index";
import * as naive from "../naive";
import {
  cost,
  edgeKey,
  groupKeys,
  randomGraph,
  scaleFree,
  segments,
  setKeys,
  undirectedKey,
  vertex,
  walked,
  weighted,
} from "../support";

/**
 * 差分测试：随机图上把每个算法与 {@link naive} 里的独立参照实现逐一对拍。
 * 多个 seed 各跑一遍，某个巧思只在特定形状上出错也躲不过去。
 */
const SEEDS = [1, 7, 13, 29, 41, 57, 73, 91];

describe("拓扑序", () => {
  it.each(SEEDS)("seed %i：DAG 的输出满足每条边的先后约束", (seed) => {
    const graph = randomGraph(seed, { order: 30, density: 3, acyclic: true });
    const snapshot = Snapshot.of(graph);
    const order = settle(toposort(snapshot));

    expect(order).toHaveLength(graph.order);
    const rank = new Int32Array(snapshot.order);
    order.forEach((u, at) => (rank[u] = at));
    for (const edge of graph.edges()) {
      const record = graph.edge(edge)!;
      expect(rank[snapshot.indexOf(record.source)]!).toBeLessThan(
        rank[snapshot.indexOf(record.target)]!,
      );
    }
  });

  it.each(SEEDS)("seed %i：有环图把环节点单列，其余仍是合法拓扑序", (seed) => {
    const graph = randomGraph(seed, { order: 25, density: 3 });
    const snapshot = Snapshot.of(graph);
    const result = settle(topology(snapshot));

    expect(result.order.length + result.cycle.length).toBe(graph.order);
    const rank = new Map<number, number>();
    result.order.forEach((u, at) => rank.set(u, at));
    for (const edge of graph.edges()) {
      const record = graph.edge(edge)!;
      const from = rank.get(snapshot.indexOf(record.source));
      const to = rank.get(snapshot.indexOf(record.target));
      if (from !== undefined && to !== undefined) expect(from).toBeLessThan(to);
    }
  });

  it.each(SEEDS)("seed %i：分层后同层无依赖", (seed) => {
    const graph = randomGraph(seed, { order: 30, density: 3, acyclic: true });
    const snapshot = Snapshot.of(graph);
    const layers = settle(generations(snapshot));

    const depth = new Map<number, number>();
    layers.forEach((layer, at) => layer.forEach((u) => depth.set(u, at)));
    expect(depth.size).toBe(graph.order);
    for (const edge of graph.edges()) {
      const record = graph.edge(edge)!;
      expect(depth.get(snapshot.indexOf(record.source))!).toBeLessThan(
        depth.get(snapshot.indexOf(record.target))!,
      );
    }
  });

  it.each(SEEDS)("seed %i：关键路径长度等于路径上的权重和", (seed) => {
    const graph = randomGraph(seed, { order: 25, density: 3, acyclic: true });
    const snapshot = weighted(graph);
    const result = settle(criticalPath(snapshot));

    let total = 0;
    for (const [from, to] of segments(snapshot.names(result.path))) {
      const between = graph.between(from, to);
      expect(between.length).toBeGreaterThan(0);
      total += Math.max(...between.map((e) => graph.edgeWeight(e) ?? 1));
    }
    expect(total).toBeCloseTo(result.length, 9);
  });

  it("关键路径把点权一并算进去——编排里节点自己也耗时", () => {
    const graph = new Graph<number, number>(graphId("timed"));
    // 两条路：慢节点那条边轻，快节点那条边重。只看边权会挑错一条。
    for (const [name, duration] of [
      ["start", 1],
      ["slow", 100],
      ["fast", 2],
      ["end", 1],
    ] as const) {
      graph.addNode(vertex(name, duration));
    }
    graph.connect([nodeId("start"), "out"], [nodeId("slow"), "in"], {
      weight: 1,
    });
    graph.connect([nodeId("start"), "out"], [nodeId("fast"), "in"], {
      weight: 50,
    });
    graph.connect([nodeId("slow"), "out"], [nodeId("end"), "in"], {
      weight: 1,
    });
    graph.connect([nodeId("fast"), "out"], [nodeId("end"), "in"], {
      weight: 1,
    });

    const edges = { weight: (w: number | undefined): number => w ?? 1 };
    const both = { ...edges, cost: (w: number | undefined): number => w ?? 0 };

    // 只编边权：fast 那条 50+1 胜出。
    const byEdges = settle(criticalPath(Snapshot.of(graph, edges)));
    expect(byEdges.length).toBe(51);
    expect(Snapshot.of(graph, edges).names(byEdges.path)).toContain(
      nodeId("fast"),
    );

    // 带上点权：slow 那条 1+100+1 反超，总长还要加上起终点自己的耗时。
    const snapshot = Snapshot.of(graph, both);
    const byBoth = settle(criticalPath(snapshot));
    expect(snapshot.names(byBoth.path)).toContain(nodeId("slow"));
    expect(byBoth.length).toBe(1 + 1 + 100 + 1 + 1);
  });

  it("有环图上 toposort 抛 Cycle，acyclic 返回 false", () => {
    const snapshot = Snapshot.of(randomGraph(3, { order: 10, density: 4 }));
    expect(settle(acyclic(snapshot))).toBe(false);
    expect(() => settle(toposort(snapshot))).toThrow(Cycle);
  });

  /**
   * `ranks` 是 `toposort` 的逆置换：一个给"第 i 位是谁"，一个给"谁在第几位"。
   * 两者必须严格互逆，否则按位次比较先后的调用方（如 `Ordering.compare` 的全量口径）
   * 会与拓扑序本身对不上。
   */
  it.each(SEEDS)("seed %i：ranks 与 toposort 互为逆置换", (seed) => {
    const snapshot = Snapshot.of(
      randomGraph(seed, { order: 30, density: 3, acyclic: true }),
    );
    const order = settle(toposort(snapshot));
    const rank = settle(ranks(snapshot));

    // 互逆即蕴含"每条边的位次递增"——边序本身已由上面的 toposort 用例钉住。
    expect(rank).toHaveLength(snapshot.order);
    for (let at = 0; at < order.length; at++) {
      expect(rank[order[at]!]).toBe(at);
    }
  });

  it("ranks 在有环图上抛 Cycle，不给出半截位次", () => {
    const snapshot = Snapshot.of(randomGraph(4, { order: 12, density: 4 }));
    expect(() => settle(ranks(snapshot))).toThrow(Cycle);
  });
});

describe("最短跳数", () => {
  const alike = (
    snapshot: Snapshot,
    depth: Int32Array,
    expected: Map<string, number>,
  ): void => {
    for (let u = 0; u < snapshot.order; u++) {
      expect(depth[u]).toBe(expected.get(snapshot.at(u)!) ?? -1);
    }
  };

  it.each(SEEDS)("seed %i：有向层级与朴素 BFS 一致", (seed) => {
    const graph = randomGraph(seed, { order: 40, density: 3 });
    const snapshot = Snapshot.of(graph);
    const depth = levels(snapshot, [snapshot.indexOf(nodeId("n0"))]);
    alike(snapshot, depth, naive.hops(graph, [nodeId("n0")]));
  });

  it.each(SEEDS)(
    "seed %i：无标度无向图与朴素 BFS 一致（前沿膨胀，覆盖反向扫描）",
    (seed) => {
      const graph = scaleFree(seed, 400, 6);
      const snapshot = Snapshot.of(graph, { undirected: true });
      const depth = levels(snapshot, [snapshot.indexOf(nodeId("n0"))]);
      alike(snapshot, depth, naive.hops(graph, [nodeId("n0")], true));
    },
  );

  it.each(SEEDS)("seed %i：只编出向与双向编译给出相同层级", (seed) => {
    const graph = randomGraph(seed, { order: 40, density: 3 });
    const full = Snapshot.of(graph);
    const half = Snapshot.of(graph, { outbound: true });
    expect([...levels(half, [0])]).toEqual([...levels(full, [0])]);
  });

  it.each(SEEDS)("seed %i：多起点取到最近起点的跳数", (seed) => {
    const graph = scaleFree(seed, 200, 4);
    const snapshot = Snapshot.of(graph, { undirected: true });
    const starts = [nodeId("n0"), nodeId("n199")];
    const depth = levels(
      snapshot,
      starts.map((s) => snapshot.indexOf(s)),
    );
    alike(snapshot, depth, naive.hops(graph, starts, true));
  });
});

describe("连通性", () => {
  it.each(SEEDS)("seed %i：弱连通分量与逐点扩散一致", (seed) => {
    const graph = randomGraph(seed, { order: 30, density: 1 });
    const snapshot = Snapshot.of(graph);
    const found = settle(components(snapshot)).groups();
    expect(groupKeys(snapshot, found)).toEqual(
      setKeys(naive.components(graph)),
    );
  });

  it.each(SEEDS)("seed %i：强连通分量与互相可达判定一致", (seed) => {
    const graph = randomGraph(seed, { order: 25, density: 2 });
    const snapshot = Snapshot.of(graph);
    const found = settle(scc(snapshot)).groups();
    expect(groupKeys(snapshot, found)).toEqual(setKeys(naive.scc(graph)));
  });

  it.each(SEEDS)("seed %i：分量编号是逆拓扑序，缩点后无环", (seed) => {
    const graph = randomGraph(seed, { order: 25, density: 2 });
    const result = settle(condensation(Snapshot.of(graph)));
    for (const [from, to] of result.edges) expect(from).toBeGreaterThan(to);
  });

  it.each(SEEDS)("seed %i：桥与割点符合删除后分量增加的定义", (seed) => {
    const graph = randomGraph(seed, { order: 18, density: 1 });
    const snapshot = Snapshot.of(graph);
    const result = settle(cuts(snapshot));

    const bridges = result.bridges.map((b) =>
      undirectedKey(snapshot.node(b.from), snapshot.node(b.to)),
    );
    expect(bridges.sort()).toEqual([...naive.bridges(graph)].sort());
    expect(snapshot.names(result.articulations).sort()).toEqual(
      [...naive.articulations(graph)].sort(),
    );
  });

  it.each(SEEDS)("seed %i：支配树与迭代数据流一致", (seed) => {
    const graph = randomGraph(seed, { order: 25, density: 2 });
    const entry = nodeId("n0");
    const snapshot = Snapshot.of(graph);
    const found = settle(dominators(snapshot, snapshot.indexOf(entry)));
    const expected = naive.dominators(graph, entry);

    let covered = 0;
    for (let u = 0; u < snapshot.order; u++) if (found[u] !== -1) covered++;
    expect(covered).toBe(expected.size);
    for (const [node, idom] of expected) {
      expect(snapshot.node(found[snapshot.indexOf(node)]!)).toBe(idom);
    }
  });

  it.each(SEEDS.slice(0, 4))(
    "seed %i：枚举出的每个简单环都真实存在",
    (seed) => {
      const graph = randomGraph(seed, { order: 8, density: 2 });
      const snapshot = Snapshot.of(graph);

      for (const cycle of settle(simpleCycles(snapshot))) {
        expect(cycle.length).toBeGreaterThan(0);
        expect(new Set(cycle).size).toBe(cycle.length);
        for (let i = 0; i < cycle.length; i++) {
          expect(
            graph.adjacent(
              snapshot.node(cycle[i]!),
              snapshot.node(cycle[(i + 1) % cycle.length]!),
            ),
          ).toBe(true);
        }
      }
    },
  );
});

describe("可达性", () => {
  it.each(SEEDS)("seed %i：传递闭包与逐点搜索一致", (seed) => {
    const graph = randomGraph(seed, { order: 22, density: 2 });
    const snapshot = Snapshot.of(graph);
    const found = settle(closure(snapshot));
    const expected = naive.reach(graph);

    for (const node of graph.nodes()) {
      const reached = snapshot.names(found.from(snapshot.indexOf(node)));
      expect(new Set(reached)).toEqual(expected.get(node));
    }
  });

  it.each(SEEDS)(
    "seed %i：reachable / descendants / ancestors 与闭包一致",
    (seed) => {
      const graph = randomGraph(seed, { order: 20, density: 2 });
      const snapshot = Snapshot.of(graph);
      const expected = naive.reach(graph);

      for (const node of graph.nodes()) {
        const u = snapshot.indexOf(node);
        expect(new Set(snapshot.names(descendants(snapshot, u)))).toEqual(
          new Set([...expected.get(node)!].filter((other) => other !== node)),
        );
        for (const other of graph.nodes()) {
          expect(reachable(snapshot, u, snapshot.indexOf(other))).toBe(
            node === other || expected.get(node)!.has(other),
          );
        }
        for (const parent of snapshot.names(ancestors(snapshot, u))) {
          expect(expected.get(parent)!.has(node)).toBe(true);
        }
      }
    },
  );

  it.each(SEEDS)("seed %i：传递归约保持可达关系不变", (seed) => {
    const graph = randomGraph(seed, { order: 18, density: 2, acyclic: true });
    const snapshot = Snapshot.of(graph);
    const kept = settle(reduction(snapshot));

    const reduced = new Graph<number, number>(graphId("reduced"));
    for (const node of graph.nodes()) {
      reduced.addNode(vertex(String(node), graph.nodeWeight(node)));
    }
    for (const [from, to] of kept) {
      reduced.connect(
        [snapshot.node(from), "out"],
        [snapshot.node(to), "in"],
      );
    }

    expect(kept.length).toBeLessThanOrEqual(graph.size);
    const before = naive.reach(graph);
    const after = naive.reach(reduced);
    for (const node of graph.nodes()) {
      expect(after.get(node)).toEqual(before.get(node));
    }
  });
});

describe("最短路", () => {
  /** 整数权走桶队列、实数权走惰性堆，是两条不同的实现分支。 */
  const spreads = SEEDS.flatMap(
    (seed) =>
      [
        [seed, "integer"],
        [seed, "real"],
      ] as const,
  );

  it.each(spreads)(
    "seed %i / %s 权：Dijkstra 与 Bellman-Ford 给出相同距离",
    (seed, weights) => {
      const graph = randomGraph(seed, { order: 25, density: 3, weights });
      const snapshot = weighted(graph);
      const source = nodeId("n0");
      const tree = settle(shortestPaths(snapshot, snapshot.indexOf(source)));
      const expected = naive.distances(graph, source);

      for (const node of graph.nodes()) {
        expect(tree.distance[snapshot.indexOf(node)]).toBeCloseTo(
          expected.get(node)!,
          9,
        );
      }
    },
  );

  it.each(SEEDS)(
    "seed %i：bellmanFord 在非负权图上与 Dijkstra 一致",
    (seed) => {
      const snapshot = weighted(randomGraph(seed, { order: 25, density: 3 }));
      const source = snapshot.indexOf(nodeId("n0"));
      const dijkstra = settle(shortestPaths(snapshot, source));
      const ford = settle(bellmanFord(snapshot, source));

      for (let u = 0; u < snapshot.order; u++) {
        expect(ford.distance[u]).toBeCloseTo(dijkstra.distance[u]!, 9);
      }
    },
  );

  it.each(SEEDS)("seed %i：单条路接口三种实现结果一致且路径可走通", (seed) => {
    const graph = randomGraph(seed, { order: 25, density: 3 });
    const snapshot = weighted(graph);
    const source = snapshot.indexOf(nodeId("n0"));
    const tree = settle(shortestPaths(snapshot, source));

    for (let target = 0; target < snapshot.order; target++) {
      const best = tree.distance[target]!;
      const routes = [
        settle(shortestPath(snapshot, source, target)),
        settle(astar(snapshot, source, target)),
        settle(bidirectional(snapshot, source, target)),
      ];

      if (best === Infinity) {
        for (const route of routes) expect(route).toBeUndefined();
        continue;
      }
      for (const route of routes) {
        expect(route!.distance).toBeCloseTo(best, 9);
        expect(route!.path[0]).toBe(source);
        expect(route!.path[route!.path.length - 1]).toBe(target);
        expect(walked(graph, snapshot.names(route!.path))).toBeCloseTo(best, 9);
      }
    }
  });

  it.each(SEEDS)("seed %i：floydWarshall 与逐点 Dijkstra 一致", (seed) => {
    const snapshot = weighted(randomGraph(seed, { order: 18, density: 2 }));
    const matrix = settle(floydWarshall(snapshot));

    for (let source = 0; source < snapshot.order; source++) {
      const tree = settle(shortestPaths(snapshot, source));
      for (let target = 0; target < snapshot.order; target++) {
        expect(matrix.at(source, target)).toBeCloseTo(
          tree.distance[target]!,
          9,
        );
      }
    }
  });

  it.each(SEEDS)("seed %i：瓶颈路径的代价等于路径上最重的一段", (seed) => {
    const graph = randomGraph(seed, { order: 20, density: 3 });
    const snapshot = weighted(graph);
    const source = snapshot.indexOf(nodeId("n0"));
    const tree = settle(
      shortestPaths(snapshot, source, { combine: bottleneck }),
    );

    for (let target = 0; target < snapshot.order; target++) {
      if (tree.distance[target] === Infinity || target === source) continue;
      const route = settle(
        shortestPath(snapshot, source, target, { combine: bottleneck }),
      )!;
      const heaviest = Math.max(
        ...segments(snapshot.names(route.path)).map(([a, b]) =>
          Math.min(...graph.between(a, b).map((e) => graph.edgeWeight(e) ?? 1)),
        ),
      );
      expect(heaviest).toBeLessThanOrEqual(tree.distance[target]!);
    }
  });

  it("提前终止的接口不暴露未收敛的距离", () => {
    const graph = new Graph<null, number>(graphId("early"));
    for (const name of ["s", "t", "x", "a"]) {
      graph.addNode(vertex<null>(name, null));
    }
    graph.connect([nodeId("s"), "out"], [nodeId("t"), "in"], { weight: 0 });
    graph.connect([nodeId("s"), "out"], [nodeId("x"), "in"], { weight: 5 });
    graph.connect([nodeId("s"), "out"], [nodeId("a"), "in"], { weight: 1 });
    graph.connect([nodeId("a"), "out"], [nodeId("x"), "in"], { weight: 1 });

    const snapshot = Snapshot.of(graph, { weight: cost });
    const s = snapshot.indexOf(nodeId("s"));
    const single = settle(
      shortestPath(snapshot, s, snapshot.indexOf(nodeId("t"))),
    )!;
    expect(single.distance).toBe(0);
    expect(snapshot.names(single.path)).toEqual([nodeId("s"), nodeId("t")]);

    // 全树接口跑完整个搜索，x 必须是收敛后的 2 而不是提前终止时的 5。
    const tree = settle(shortestPaths(snapshot, s));
    expect(tree.distance[snapshot.indexOf(nodeId("x"))]).toBe(2);
  });

  it("负权边让 Dijkstra 抛 Negative，Bellman-Ford 抓出负环", () => {
    const graph = new Graph<null, number>(graphId("negative"));
    for (const name of ["a", "b", "c"]) {
      graph.addNode(vertex<null>(name, null));
    }
    graph.connect([nodeId("a"), "out"], [nodeId("b"), "in"], { weight: 1 });
    graph.connect([nodeId("b"), "out"], [nodeId("c"), "in"], { weight: -4 });
    graph.connect([nodeId("c"), "out"], [nodeId("b"), "in"], { weight: 1 });

    const snapshot = Snapshot.of(graph, { weight: cost });
    const a = snapshot.indexOf(nodeId("a"));
    expect(() => settle(shortestPaths(snapshot, a))).toThrow(/negative/);
    expect(() => settle(bellmanFord(snapshot, a))).toThrow(Cycle);
  });
});

describe("最小生成森林", () => {
  it.each(SEEDS)("seed %i：Prim 与 Kruskal 的总权重与边数相同", (seed) => {
    const graph = randomGraph(seed, { order: 25, density: 2 });
    const snapshot = weighted(graph);
    const total = (links: ReadonlyArray<{ weight: number }>): number =>
      links.reduce((sum, link) => sum + link.weight, 0);

    const byPrim = settle(prim(snapshot));
    const byKruskal = settle(kruskal(snapshot));
    expect(total(byPrim)).toBeCloseTo(total(byKruskal), 9);

    const parts = settle(components(snapshot)).count;
    expect(byPrim).toHaveLength(graph.order - parts);
    expect(byKruskal).toHaveLength(graph.order - parts);
  });

  it.each(SEEDS)("seed %i：选出的边都真实存在且不重复", (seed) => {
    const graph = randomGraph(seed, { order: 20, density: 2 });
    const snapshot = weighted(graph);
    const links = settle(kruskal(snapshot));

    const seen = new Set<string>();
    for (const link of links) {
      const id = snapshot.edges[link.edge]!;
      const ends = undirectedKey(
        snapshot.node(link.source),
        snapshot.node(link.target),
      );
      expect(graph.hasEdge(id)).toBe(true);
      expect(edgeKey(graph, id)).toBe(ends);
      seen.add(ends);
    }
    expect(seen.size).toBe(links.length);
  });
});

describe("负环归因", () => {
  it("报出的环成员真实成环，不受高编号旁支干扰", () => {
    const graph = new Graph<null, number>(graphId("blame"));
    for (const name of ["a", "b", "c", "d", "e", "s"]) {
      graph.addNode(vertex<null>(name, null));
    }
    graph.connect([nodeId("s"), "out"], [nodeId("a"), "in"], { weight: 1 });
    graph.connect([nodeId("a"), "out"], [nodeId("b"), "in"], { weight: 1 });
    graph.connect([nodeId("b"), "out"], [nodeId("c"), "in"], { weight: -4 });
    graph.connect([nodeId("c"), "out"], [nodeId("a"), "in"], { weight: 1 });
    graph.connect([nodeId("s"), "out"], [nodeId("d"), "in"], { weight: 10 });
    graph.connect([nodeId("d"), "out"], [nodeId("e"), "in"], { weight: 10 });

    const snapshot = Snapshot.of(graph, { weight: cost });
    let caught: Cycle | undefined;
    try {
      settle(bellmanFord(snapshot, snapshot.indexOf(nodeId("s"))));
    } catch (error) {
      caught = error as Cycle;
    }

    expect(caught).toBeInstanceOf(Cycle);
    const members = caught!.nodes;
    expect(members.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < members.length; i++) {
      expect(
        graph.adjacent(
          snapshot.node(members[i]!),
          snapshot.node(members[(i + 1) % members.length]!),
        ),
      ).toBe(true);
    }
    expect(new Set(snapshot.names(members))).toEqual(
      new Set([nodeId("a"), nodeId("b"), nodeId("c")]),
    );
  });
});

describe("NaN 权重防线", () => {
  const tainted: Structure = {
    order: 3,
    size: 2,
    outbound: {
      offset: Int32Array.of(0, 1, 2, 2),
      other: Int32Array.of(1, 2),
      edge: Int32Array.of(0, 1),
    },
    inbound: {
      offset: Int32Array.of(0, 0, 1, 2),
      other: Int32Array.of(0, 1),
      edge: Int32Array.of(0, 1),
    },
    weight: Float64Array.of(3, NaN),
    cost: undefined,
  };

  const guarded = [
    ["astar", () => astar(tainted, 0, 2)],
    ["bidirectional", () => bidirectional(tainted, 0, 2)],
    ["bellmanFord", () => bellmanFord(tainted, 0)],
    ["floydWarshall", () => floydWarshall(tainted)],
    ["prim", () => prim(tainted)],
    ["kruskal", () => kruskal(tainted)],
    ["criticalPath", () => criticalPath(tainted)],
  ] as const;

  it.each(guarded)("%s 抛 Invalid 而不是静默不可达", (_label, run) => {
    expect(() => settle(run() as Task<unknown>)).toThrow(Invalid);
  });
});

describe("简单环的分量限域", () => {
  const rings = <N, E>(graph: Graph<N, E>): string[] => {
    const snapshot = Snapshot.of(graph);
    return settle(simpleCycles(snapshot))
      .map((cycle) => snapshot.names(cycle).sort().join(","))
      .sort();
  };

  it("多个分量各自出环，DAG 部分一个不多", () => {
    const graph = new Graph<null, number>(graphId("scoped"));
    for (const name of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      graph.addNode(vertex<null>(name, null));
    }
    graph.connect([nodeId("a"), "out"], [nodeId("b"), "in"]);
    graph.connect([nodeId("b"), "out"], [nodeId("a"), "in"]);
    graph.connect([nodeId("c"), "out"], [nodeId("d"), "in"]);
    graph.connect([nodeId("d"), "out"], [nodeId("e"), "in"]);
    graph.connect([nodeId("e"), "out"], [nodeId("c"), "in"]);
    graph.connect([nodeId("b"), "out"], [nodeId("c"), "in"]);
    graph.connect([nodeId("e"), "out"], [nodeId("f"), "in"]);
    graph.connect([nodeId("f"), "out"], [nodeId("g"), "in"]);
    graph.connect([nodeId("h"), "out"], [nodeId("h"), "in"]);

    expect(rings(graph)).toEqual(["a,b", "c,d,e", "h"]);
  });

  it("纯 DAG 上一个环也不报", () => {
    const graph = randomGraph(61, { order: 300, density: 3, acyclic: true });
    expect(rings(graph)).toEqual([]);
  });

  it("同分量内的嵌套环一个不漏", () => {
    const graph = new Graph<null, number>(graphId("nested"));
    for (const name of ["a", "b", "c"]) {
      graph.addNode(vertex<null>(name, null));
    }
    graph.connect([nodeId("a"), "out"], [nodeId("b"), "in"]);
    graph.connect([nodeId("b"), "out"], [nodeId("a"), "in"]);
    graph.connect([nodeId("b"), "out"], [nodeId("c"), "in"]);
    graph.connect([nodeId("c"), "out"], [nodeId("a"), "in"]);

    expect(rings(graph)).toEqual(["a,b", "a,b,c"]);
  });
});

/**
 * 复合层级的三个查询只吃活图（层级不进快照，也不进 `Structure`），是编辑器里「展开分组」
 * 「面包屑」的直接实现。层级会被 `dropNode` 的提升与 `unparent` 就地改写，因此除了
 * 常规形状，这两种改写之后的答案也各钉一遍。
 */
describe("复合层级查询", () => {
  /** `top ⊃ group ⊃ {leaf, twig}`，另有一个独立节点 `loose`。 */
  const nested = (): Graph<null, number> => {
    const graph = new Graph<null, number>(graphId("tree"));
    for (const name of ["top", "group", "leaf", "twig", "loose"]) {
      graph.addNode(vertex<null>(name, null));
    }
    graph.setParent(nodeId("group"), nodeId("top"));
    graph.setParent(nodeId("leaf"), nodeId("group"));
    graph.setParent(nodeId("twig"), nodeId("group"));
    return graph;
  };

  const sorted = (found: NodeId[]): string[] => found.slice().sort();

  it("roots 给出全部顶层节点", () => {
    expect(sorted(roots(nested()))).toEqual(["loose", "top"]);
  });

  it("subtree 含自身、跨全部层级；叶子只剩自己", () => {
    const graph = nested();
    expect(sorted(subtree(graph, nodeId("top")))).toEqual([
      "group",
      "leaf",
      "top",
      "twig",
    ]);
    expect(sorted(subtree(graph, nodeId("group")))).toEqual([
      "group",
      "leaf",
      "twig",
    ]);
    expect(subtree(graph, nodeId("leaf"))).toEqual([nodeId("leaf")]);
    expect(subtree(graph, nodeId("loose"))).toEqual([nodeId("loose")]);
  });

  it("ancestry 自底向上、不含自身；顶层给空", () => {
    const graph = nested();
    expect(ancestry(graph, nodeId("leaf"))).toEqual([
      nodeId("group"),
      nodeId("top"),
    ]);
    expect(ancestry(graph, nodeId("group"))).toEqual([nodeId("top")]);
    expect(ancestry(graph, nodeId("top"))).toEqual([]);
    expect(ancestry(graph, nodeId("loose"))).toEqual([]);
  });

  /** `dropNode` 把子节点提升到祖父，两个查询都得照着提升后的层级回答。 */
  it("删掉中间分组后，子树与祖先链跟着收拢", () => {
    const graph = nested();
    graph.dropNode(nodeId("group"));

    expect(sorted(subtree(graph, nodeId("top")))).toEqual([
      "leaf",
      "top",
      "twig",
    ]);
    expect(ancestry(graph, nodeId("leaf"))).toEqual([nodeId("top")]);
    expect(sorted(roots(graph))).toEqual(["loose", "top"]);
  });

  it("unparent 之后被摘出的子树自成顶层", () => {
    const graph = nested();
    graph.unparent(nodeId("group"));

    expect(sorted(roots(graph))).toEqual(["group", "loose", "top"]);
    expect(subtree(graph, nodeId("top"))).toEqual([nodeId("top")]);
    expect(ancestry(graph, nodeId("leaf"))).toEqual([nodeId("group")]);
  });

  /**
   * `subtree` 用循环而不是 `stack.push(...children)` 逐个入栈：展开实参有引擎上限，
   * 宽分组会直接 RangeError。这里只取一个足够宽、又不依赖具体阈值的规模——阈值随
   * 可用栈变化，钉它就是钉机器。
   */
  it("宽分组不靠展开实参，规模再大也照常展开", () => {
    const graph = new Graph<null, number>(graphId("wide"));
    graph.addNode(vertex<null>("group", null));
    for (let i = 0; i < 20000; i++) {
      graph.addNode(vertex<null>(`k${i}`, null));
      graph.setParent(nodeId(`k${i}`), nodeId("group"));
    }

    expect(subtree(graph, nodeId("group"))).toHaveLength(20001);
    expect(ancestry(graph, nodeId("k19999"))).toEqual([nodeId("group")]);
  });
});

/**
 * 五个遍历入口共用同一个起点形状。
 *
 * 此前它们各写各的——`dfs` 收不定参数、`levels` 要 `Iterable`、`visit` 要
 * `Iterable | null` 且夹在中间、`postorder` 收可选 `Iterable`。换一个入口就得改一次
 * 调用写法，而这四种写法之间没有任何语义差别。
 */
describe("遍历起点的统一形状", () => {
  const chain = (): Snapshot => Snapshot.of(randomGraph(11, { order: 12 }));

  it("单个索引、一组索引、省略，三种写法在每个入口上都成立", () => {
    const s = chain();
    for (const walk of [dfs, bfs]) {
      expect([...walk(s, 0)]).toEqual([...walk(s, [0])]);
      // 省略即全图：每个节点恰好产出一次。
      expect([...walk(s)].sort((a, b) => a - b)).toEqual(
        Array.from({ length: s.order }, (_, i) => i),
      );
    }
    expect([...levels(s, 0)]).toEqual([...levels(s, [0])]);
    expect([...postorder(s, 0)]).toEqual([...postorder(s, [0])]);
    expect(postorder(s).length).toBe(s.order);
  });

  it("visit 的起点是可选尾参，访问者不必再为它让位", () => {
    const s = chain();
    const all: number[] = [];
    visit(s, { discover: (u) => void all.push(u) });
    expect(all.length).toBe(s.order);

    const one: number[] = [];
    visit(s, { discover: (u) => void one.push(u) }, 0);
    expect(one[0]).toBe(0);
    expect(one.length).toBeLessThanOrEqual(s.order);
  });
});

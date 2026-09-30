import { test } from "vitest";

import {
  closure,
  components,
  diff,
  dominators,
  floydWarshall,
  kruskal,
  levels,
  nodeId,
  pack,
  reduction,
  scc,
  settle,
  shortestPaths,
  Snapshot,
  toposort,
  unpack,
} from "../../index";
import { cost, randomGraph, scaleFree, weighted } from "../support";

const graph = randomGraph(2026, { order: 5000, density: 8, acyclic: true });
const snapshot = weighted(graph);
const nodes = graph.nodes();
const source = snapshot.indexOf(nodeId("n0"));
const bundle = pack(graph);
const first = graph.edges()[0]!;
let tick = 0;

test(`邻接遍历（V=${graph.order} E=${graph.size}）`, async ({ bench }) => {
  await bench.compare(
    bench("Graph.forEachOut 全图（零分配）", () => {
      let seen = 0;
      for (const node of nodes) graph.forEachOut(node, () => void seen++);
    }),
    bench("Graph.outNeighbors 全图（每次分配数组）", () => {
      let seen = 0;
      for (const node of nodes) seen += graph.outNeighbors(node).length;
    }),
    bench("Snapshot CSR 直读", () => {
      const { offset, other } = snapshot.outbound;
      let seen = 0;
      for (let u = 0; u < snapshot.order; u++) {
        for (let k = offset[u]!; k < offset[u + 1]!; k++) seen += other[k]!;
      }
    }),
  );
});

test("快照编译", async ({ bench }) => {
  await bench.compare(
    bench("双向带权", () => {
      weighted(graph);
    }),
    bench("单向带权（outbound）", () => {
      Snapshot.of(graph, { weight: cost, outbound: true });
    }),
    bench("双向无权", () => {
      Snapshot.of(graph);
    }),
    bench("增量重编译（只动了权重）", () => {
      graph.setEdgeWeight(first, (tick++ % 9) + 1);
      Snapshot.of(graph, { weight: cost, reuse: snapshot });
    }),
  );
});

test("算法（同一份快照）", async ({ bench }) => {
  await bench.compare(
    bench("toposort", () => {
      settle(toposort(snapshot));
    }),
    bench("scc", () => {
      settle(scc(snapshot));
    }),
    bench("components", () => {
      settle(components(snapshot));
    }),
    bench("shortestPaths", () => {
      settle(shortestPaths(snapshot, source));
    }),
    bench("dominators", () => {
      settle(dominators(snapshot, source));
    }),
    bench("kruskal", () => {
      settle(kruskal(snapshot));
    }),
  );
});

test("分层 BFS（V=100k，形状决定方向切换是否触发）", async ({ bench }) => {
  const social = Snapshot.of(scaleFree(2026, 100_000, 8), {
    undirected: true,
  });
  const sparse = Snapshot.of(randomGraph(2026, { order: 100_000, density: 3 }));

  await bench.compare(
    bench("levels：无标度无向（前沿膨胀，走反向扫描）", () => {
      levels(social, [0]);
    }),
    bench("levels：均匀稀疏有向（前沿窄，始终正向）", () => {
      levels(sparse, [0]);
    }),
  );
});

test("传递归约（V=400，闭包位图规模敏感）", async ({ bench }) => {
  const small = Snapshot.of(
    randomGraph(7, { order: 400, density: 3, acyclic: true }),
  );

  await bench("reduction", () => {
    settle(reduction(small));
  }).run();
});

test("序列化", async ({ bench }) => {
  await bench.compare(
    bench("pack", () => {
      pack(graph);
    }),
    bench("unpack", () => {
      unpack(bundle);
    }),
  );
});

test("传递闭包（位图是 count × ⌈V/32⌉ 字，随 V 平方增长）", async ({
  bench,
}) => {
  const dense = Snapshot.of(
    randomGraph(11, { order: 1500, density: 3, acyclic: true }),
  );

  await bench("closure", () => {
    settle(closure(dense));
  }).run();
});

test("全源最短路（矩阵 8·V²）", async ({ bench }) => {
  const small = weighted(randomGraph(12, { order: 300, density: 3 }));

  await bench("floydWarshall", () => {
    settle(floydWarshall(small));
  }).run();
});

test("结构化差异（整图对比，只有一处真实改动）", async ({ bench }) => {
  const before = randomGraph(13, { order: 4000, density: 4, acyclic: true });
  const after = before.copy();
  after.setWeight(nodeId("n0"), 12345);

  await bench("diff", () => {
    diff(before, after);
  }).run();
});

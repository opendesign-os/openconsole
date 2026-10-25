import { describe, expect, it } from "vitest";

import {
  Graph,
  graphId,
  inDegree,
  Invalid,
  merged,
  nodeId,
  Oneway,
  outDegree,
  scc,
  Schema,
  settle,
  shortestPath,
  Snapshot,
  Socket,
  Stale,
  toposort,
  Vertex,
  weightOf,
  type NodeId,
  type Sockets,
  type Wire,
} from "../../index";
import { cost, outOf, randomGraph, vertex, weighted } from "../support";

/** 一个带命名分支的节点：`in` 进，`yes` / `no` 两个引脚出。 */
const branching = (name: string): Vertex<Sockets, Sockets, number> =>
  new Vertex<Sockets, Sockets, number>(nodeId(name), 0)
    .addInput("in", Socket.exec)
    .addOutput("yes", Socket.exec, { multiple: false })
    .addOutput("no", Socket.exec, { multiple: false });

function router(): Graph<number, number> {
  const graph = new Graph<number, number>(graphId("router"));
  for (const name of ["a", "b", "c"]) graph.addNode(branching(name));
  graph.connect([nodeId("a"), "yes"], [nodeId("b"), "in"]);
  graph.connect([nodeId("a"), "no"], [nodeId("c"), "in"]);
  return graph;
}

/** 端口层：两条标注都只从接线上取，因此不随权重变动。 */
const PORTS = {
  source: (wire: Wire): string => wire.sourcePort,
  target: (wire: Wire): string => wire.targetPort,
};

/** 从 `u` 沿指定引脚走出去的全部目标，全程在索引空间。 */
function branch(snapshot: Snapshot, node: NodeId, port: string): NodeId[] {
  const u = snapshot.indexOf(node);
  const pin = snapshot.code(port);
  const source = snapshot.layer("source");
  const { offset, other, edge } = snapshot.outbound;
  const found: NodeId[] = [];
  for (let k = offset[u]!; k < offset[u + 1]!; k++) {
    if (source[edge[k]!] === pin) found.push(snapshot.node(other[k]!));
  }
  return found.sort();
}

describe("编译", () => {
  it("邻接与源图一致", () => {
    const graph = randomGraph(21, { order: 25, density: 3 });
    const snapshot = Snapshot.of(graph);

    expect(snapshot.order).toBe(graph.order);
    expect(snapshot.size).toBe(graph.size);
    for (const node of graph.nodes()) {
      expect(outOf(snapshot, node)).toEqual(
        graph.outNeighbors(node).slice().sort(),
      );
      const u = snapshot.indexOf(node);
      expect(outDegree(snapshot, u)).toBe(graph.outDegree(node));
      expect(inDegree(snapshot, u)).toBe(graph.inDegree(node));
    }
  });

  it("跳过删除留下的空位", () => {
    const graph = randomGraph(22, { order: 15, density: 2 });
    for (const node of graph.nodes().slice(0, 5)) graph.dropNode(node);
    const snapshot = Snapshot.of(graph);

    expect(snapshot.order).toBe(graph.order);
    expect(snapshot.nodes.every((id) => graph.hasNode(id))).toBe(true);
  });

  it("平行边各有独立权重", () => {
    const graph = new Graph<null, number>(graphId("parallel"));
    graph.addNode(vertex<null>("a", null));
    graph.addNode(vertex<null>("b", null));
    graph.connect([nodeId("a"), "out"], [nodeId("b"), "in"], { weight: 3 });
    graph.connect([nodeId("a"), "out"], [nodeId("b"), "in"], { weight: 7 });

    const snapshot = Snapshot.of(graph, { weight: cost });
    const { offset, edge } = snapshot.outbound;
    const u = snapshot.indexOf(nodeId("a"));
    const weights: number[] = [];
    for (let k = offset[u]!; k < offset[u + 1]!; k++) {
      weights.push(weightOf(snapshot, edge[k]!));
    }
    expect(weights.sort()).toEqual([3, 7]);
  });

  it("NaN 权在编译期就报错，并报得出是哪条边", () => {
    // NaN 与任何值比较都是 false：漏到算法里就是连通节点被静默报成不可达。
    const graph = randomGraph(5, { order: 6, density: 2 });
    expect(() => Snapshot.of(graph, { weight: () => NaN })).toThrow(Invalid);
    expect(() => Snapshot.of(graph, { weight: () => NaN })).toThrow(
      new RegExp(`edge ${graph.edgeIdAt(0)}`),
    );
  });

  it("未编译权重时每条边按 1 计", () => {
    const snapshot = Snapshot.of(randomGraph(23, { order: 10, density: 2 }));
    expect(snapshot.weight).toBeUndefined();
    expect(weightOf(snapshot, 0)).toBe(1);
  });
});

describe("编译期视图", () => {
  it("节点过滤只保留满足谓词的节点及其内部边", () => {
    const graph = randomGraph(24, { order: 20, density: 2 });
    const keep = (node: NodeId): boolean =>
      Number(String(node).slice(1)) % 2 === 0;
    const snapshot = Snapshot.of(graph, { node: keep });

    expect(snapshot.nodes.every(keep)).toBe(true);
    for (const node of snapshot.nodes) {
      expect(outOf(snapshot, node)).toEqual(
        graph.outNeighbors(node).filter(keep).slice().sort(),
      );
    }
  });

  it("边过滤按边谓词裁剪", () => {
    const graph = randomGraph(25, { order: 15, density: 3 });
    const heavy = Snapshot.of(graph, {
      edge: (edge) => (edge.weight ?? 0) > 5,
      weight: cost,
    });

    expect(heavy.order).toBe(graph.order);
    expect([...heavy.weight!].every((value) => value > 5)).toBe(true);
  });

  it("折叠把分组当单节点：组内边消失，跨组边聚合到组上", () => {
    const graph = new Graph<null, number>(graphId("folded"));
    for (const name of ["group", "x", "y", "outside"]) {
      graph.addNode(vertex<null>(name, null));
    }
    graph.setParent(nodeId("x"), nodeId("group"));
    graph.setParent(nodeId("y"), nodeId("group"));
    graph.connect([nodeId("x"), "out"], [nodeId("y"), "in"]);
    graph.connect([nodeId("y"), "out"], [nodeId("outside"), "in"]);

    const snapshot = Snapshot.of(graph, { collapse: [nodeId("group")] });
    expect(new Set(snapshot.nodes)).toEqual(
      new Set([nodeId("group"), nodeId("outside")]),
    );
    expect(outOf(snapshot, nodeId("group"))).toEqual([nodeId("outside")]);
    expect(snapshot.size).toBe(1);
  });

  it("折叠后的图仍可直接跑算法", () => {
    const graph = randomGraph(26, { order: 16, density: 2, acyclic: true });
    graph.setParent(nodeId("n2"), nodeId("n1"));
    graph.setParent(nodeId("n3"), nodeId("n1"));
    const folded = Snapshot.of(graph, { collapse: [nodeId("n1")] });

    expect(folded.order).toBe(graph.order - 2);
    expect(settle(scc(folded)).count).toBeGreaterThan(0);
  });

  it("无向编译让每条边在两端各出现一次", () => {
    const graph = new Graph<null, number>(graphId("undirected"));
    graph.addNode(vertex<null>("a", null));
    graph.addNode(vertex<null>("b", null));
    graph.connect([nodeId("a"), "out"], [nodeId("b"), "in"]);

    const snapshot = Snapshot.of(graph, { undirected: true });
    expect(outOf(snapshot, nodeId("a"))).toEqual([nodeId("b")]);
    expect(outOf(snapshot, nodeId("b"))).toEqual([nodeId("a")]);
    expect(merged(snapshot)).toBe(true);
  });

  it("outbound 省掉入向邻接，只用出边的算法照常工作", () => {
    const graph = randomGraph(27, { order: 12, density: 2, acyclic: true });
    const snapshot = Snapshot.of(graph, { outbound: true });

    expect(snapshot.inbound).toBeUndefined();
    expect(() => snapshot.reverse()).toThrow(Oneway);
    expect(settle(toposort(snapshot))).toHaveLength(graph.order);
  });

  it("reverse 翻转方向、共享底层数组，且不重建索引表", () => {
    const graph = randomGraph(28, { order: 15, density: 2 });
    const snapshot = Snapshot.of(graph);
    const flipped = snapshot.reverse();

    expect(flipped.outbound).toBe(snapshot.inbound);
    expect(flipped.inbound).toBe(snapshot.outbound);
    for (const node of graph.nodes()) {
      expect(flipped.indexOf(node)).toBe(snapshot.indexOf(node));
      expect(outOf(flipped, node)).toEqual(
        graph.inNeighbors(node).slice().sort(),
      );
    }

    const wide = Snapshot.of(randomGraph(32, { order: 4000, density: 2 }));
    const started = performance.now();
    for (let i = 0; i < 2000; i++) wide.reverse();
    // 逐次重建索引表的话，2000 × 4000 次 Map.set 远超这个上限。
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe("与源图的同步", () => {
  it("图未变时 current 为真，变更后 verify 抛 Stale", () => {
    const graph = randomGraph(29, { order: 10, density: 2 });
    const snapshot = Snapshot.of(graph);
    expect(snapshot.current).toBe(true);
    expect(() => snapshot.verify()).not.toThrow();

    graph.addNode(vertex("extra", 99));
    expect(snapshot.current).toBe(false);
    expect(() => snapshot.verify()).toThrow(Stale);
  });
});

describe("跨线程搬运", () => {
  it("data 可结构化克隆，还原出等价快照", () => {
    const graph = randomGraph(31, { order: 20, density: 2 });
    const snapshot = weighted(graph);
    const revived = Snapshot.from(structuredClone(snapshot.data));

    expect(revived.order).toBe(snapshot.order);
    expect(revived.size).toBe(snapshot.size);
    expect([...revived.nodes]).toEqual([...snapshot.nodes]);
    expect([...revived.weight!]).toEqual([...snapshot.weight!]);
    for (const node of graph.nodes()) {
      expect(outOf(revived, node)).toEqual(outOf(snapshot, node));
    }
    // 还原出来的快照没有源图，因此不会误报陈旧。
    expect(revived.current).toBe(true);
    expect(settle(scc(revived)).count).toBe(settle(scc(snapshot)).count);
  });

  it("core 省掉标签层，索引空间算法照跑，问名字则明确报错", () => {
    const graph = randomGraph(31, { order: 20, density: 2, acyclic: true });
    const snapshot = weighted(graph);
    const revived = Snapshot.from(structuredClone(snapshot.core));

    expect([...settle(toposort(revived))]).toEqual([
      ...settle(toposort(snapshot)),
    ]);
    expect(revived.at(0)).toBeUndefined();
    expect(revived.indexOf(graph.nodes()[0]!)).toBe(-1);
    expect(() => revived.names([0])).toThrow(/without the label layer/);
  });

  /**
   * `data` 的契约是"交给 postMessage、`Snapshot.from` 可还原"。按 core 还原的快照
   * 没有标签层，它的 `data` 必须把空标签还原成"缺省"——原样带上空数组的话，
   * 中转 Worker 转发时会被判作"0 个标签对 N 个节点"的矛盾数据。
   */
  it("core 还原的快照可以按 data 再转发一跳", () => {
    const graph = randomGraph(31, { order: 20, density: 2 });
    const snapshot = weighted(graph);
    const relay = Snapshot.from(structuredClone(snapshot.core));
    const again = Snapshot.from(structuredClone(relay.data));

    expect(again.order).toBe(snapshot.order);
    expect(again.size).toBe(snapshot.size);
    expect(settle(scc(again)).count).toBe(settle(scc(snapshot)).count);
    // 转发一跳后依然是"没有标签层"的快照，语义不变。
    expect(() => again.names([0])).toThrow(/without the label layer/);
  });
});

describe("增量重编译", () => {
  const build = (): Graph<number, number> =>
    randomGraph(89, { order: 200, density: 3 });

  /** 点权回调要提成稳定引用，否则每次调用都换了语义，按引用判同必然重算。 */
  const price = (weight: number | undefined): number => weight ?? 0;

  it("什么都没变时原样返回同一个快照", () => {
    const graph = build();
    const base = weighted(graph);
    expect(Snapshot.of(graph, { weight: cost, reuse: base })).toBe(base);
  });

  it("改节点参数不牵动边权数组——编辑器里最频繁的那类变更", () => {
    const graph = build();
    const base = weighted(graph);
    graph.setWeight(graph.nodes()[0]!, 42);

    const next = Snapshot.of(graph, { weight: cost, reuse: base });
    // 图确实变了，快照得跟上 revision，否则 verify() 会误报陈旧。
    expect(next).not.toBe(base);
    expect(next.revision).toBe(graph.revision);
    expect(next.current).toBe(true);
    // 但边权一条都没重算：整份原样复用，O(1) 而不是 O(E)。
    expect(next.weight).toBe(base.weight);
    expect(next.outbound).toBe(base.outbound);
    expect(next.nodes).toBe(base.nodes);
  });

  it("改边权不牵动点权数组，两条各自作废", () => {
    const graph = build();
    const options = { weight: cost, cost: price };
    const base = Snapshot.of(graph, options);
    graph.setEdgeWeight(graph.edges()[0]!, 999);

    const next = Snapshot.of(graph, { ...options, reuse: base });
    expect(next.weight).not.toBe(base.weight);
    expect(next.cost).toBe(base.cost);

    graph.setWeight(graph.nodes()[0]!, 7);
    const third = Snapshot.of(graph, { ...options, reuse: next });
    expect(third.cost).not.toBe(next.cost);
    expect(third.weight).toBe(next.weight);
  });

  it("只动权重时复用 CSR，只重算权重数组", () => {
    const graph = build();
    const base = weighted(graph);
    const edge = graph.edges()[0]!;
    graph.setEdgeWeight(edge, 999);

    const next = Snapshot.of(graph, { weight: cost, reuse: base });
    expect(next).not.toBe(base);
    expect(next.outbound).toBe(base.outbound);
    expect(next.inbound).toBe(base.inbound);
    expect(next.nodes).toBe(base.nodes);
    expect(next.edges).toBe(base.edges);
    expect(next.weight).not.toBe(base.weight);
    expect(next.current).toBe(true);

    expect(next.weight![base.edges.indexOf(edge)]).toBe(999);
    expect([...next.weight!]).toEqual([...weighted(graph).weight!]);
  });

  it("复用出来的快照不吃旧的边权画像缓存", () => {
    const graph = new Graph<number, number>(graphId("reweigh"));
    for (const name of ["a", "b", "c"]) graph.addNode(vertex(name, 0));
    graph.connect([nodeId("a"), "out"], [nodeId("b"), "in"], { weight: 1 });
    const long = graph.connect([nodeId("b"), "out"], [nodeId("c"), "in"], {
      weight: 1,
    });
    graph.connect([nodeId("a"), "out"], [nodeId("c"), "in"], { weight: 5 });

    const base = weighted(graph);
    expect(settle(shortestPath(base, 0, 2))!.distance).toBe(2);

    graph.setEdgeWeight(long, 100);
    const next = Snapshot.of(graph, { weight: cost, reuse: base });
    expect(settle(shortestPath(next, 0, 2))!.distance).toBe(5);
  });

  it("结构一变就退回全量编译", () => {
    const graph = build();
    const base = weighted(graph);
    graph.addNode(vertex("extra", 0));

    const next = Snapshot.of(graph, { weight: cost, reuse: base });
    expect(next.outbound).not.toBe(base.outbound);
    expect(next.order).toBe(base.order + 1);
  });

  it("weight 回调引用变了就重算权重，不再原样返回", () => {
    const graph = build();
    const base = weighted(graph);

    const doubled = Snapshot.of(graph, {
      weight: (weight) => (weight ?? 1) * 2,
      reuse: base,
    });
    expect(doubled).not.toBe(base);
    expect(doubled.outbound).toBe(base.outbound);
    expect([...doubled.weight!]).toEqual([...base.weight!].map((w) => w * 2));

    expect(Snapshot.of(graph, { weight: cost, reuse: doubled })).not.toBe(
      doubled,
    );
    expect(Snapshot.of(graph, { weight: cost, reuse: base })).toBe(base);
  });

  it("带谓词、换选项、传别的图、传翻转过的快照，都只是没有加速", () => {
    const graph = build();
    const base = weighted(graph);
    graph.setEdgeWeight(graph.edges()[0]!, 2);

    const filtered = Snapshot.of(graph, {
      weight: cost,
      reuse: base,
      node: () => true,
    });
    expect(filtered.outbound).not.toBe(base.outbound);

    const undirected = Snapshot.of(graph, {
      weight: cost,
      reuse: base,
      undirected: true,
    });
    expect(undirected.outbound).not.toBe(base.outbound);
    expect(merged(undirected)).toBe(true);

    const stranger = weighted(randomGraph(90, { order: 30, density: 2 }));
    const crossed = Snapshot.of(graph, { weight: cost, reuse: stranger });
    expect(crossed.order).toBe(graph.order);
    expect(crossed.outbound).not.toBe(stranger.outbound);

    // 翻转过的快照方向与选项对不上，复用它会静默给出反向结构。
    const flipped = Snapshot.of(graph, {
      weight: cost,
      reuse: base.reverse(),
    });
    expect([...flipped.outbound.other]).toEqual([...base.outbound.other]);
  });
});

describe("平行边合并", () => {
  const parallel = (): Graph<null, number> => {
    const graph = new Graph<null, number>(graphId("merge"));
    graph.addNode(vertex<null>("a", null));
    graph.addNode(vertex<null>("b", null));
    graph.connect([nodeId("a"), "out"], [nodeId("b"), "in"], { weight: 3 });
    graph.connect([nodeId("a"), "out"], [nodeId("b"), "in"], { weight: 7 });
    graph.connect([nodeId("a"), "out"], [nodeId("b"), "in"], { weight: 5 });
    return graph;
  };

  it("同向平行边折成一条，权重按 merge 聚合", () => {
    const graph = parallel();
    const least = Snapshot.of(graph, { weight: cost, merge: Math.min });
    expect(least.size).toBe(1);
    expect([...least.weight!]).toEqual([3]);

    const total = Snapshot.of(graph, {
      weight: cost,
      merge: (a, b) => a + b,
    });
    expect([...total.weight!]).toEqual([15]);
  });

  it("边 id 取首条，标签层与合并后的边一一对应", () => {
    const graph = parallel();
    const snapshot = Snapshot.of(graph, { weight: cost, merge: Math.min });
    expect(snapshot.edges).toHaveLength(1);
    expect(snapshot.edges[0]).toBe(graph.edges()[0]);
  });

  it("不带权重时只去重，不碰 merge 回调", () => {
    const snapshot = Snapshot.of(parallel(), {
      merge: () => {
        throw new Error("unreachable");
      },
    });
    expect(snapshot.size).toBe(1);
    expect(snapshot.weight).toBeUndefined();
  });

  it("无向合并把两个方向折成一条", () => {
    const graph = new Graph<null, number>(graphId("both"));
    graph.addNode(vertex<null>("a", null));
    graph.addNode(vertex<null>("b", null));
    graph.connect([nodeId("a"), "out"], [nodeId("b"), "in"], { weight: 4 });
    graph.connect([nodeId("b"), "out"], [nodeId("a"), "in"], { weight: 9 });

    const snapshot = Snapshot.of(graph, {
      weight: cost,
      undirected: true,
      merge: Math.min,
    });
    expect(snapshot.size).toBe(1);
    expect([...snapshot.weight!]).toEqual([4]);
    expect(outOf(snapshot, nodeId("a"))).toEqual([nodeId("b")]);
    expect(outOf(snapshot, nodeId("b"))).toEqual([nodeId("a")]);
  });

  it("真自环在合并下保留一条", () => {
    const graph = new Graph<null, number>(graphId("loop"));
    graph.addNode(vertex<null>("a", null));
    graph.connect([nodeId("a"), "out"], [nodeId("a"), "in"], { weight: 2 });
    graph.connect([nodeId("a"), "out"], [nodeId("a"), "in"], { weight: 6 });

    const snapshot = Snapshot.of(graph, { weight: cost, merge: Math.min });
    expect(snapshot.size).toBe(1);
    expect([...snapshot.weight!]).toEqual([2]);
  });

  it("merge 给出 NaN 时报错并点名边", () => {
    expect(() =>
      Snapshot.of(parallel(), { weight: cost, merge: () => NaN }),
    ).toThrow(Invalid);
  });

  it("合并编译不参与增量复用", () => {
    const graph = parallel();
    const base = Snapshot.of(graph, { weight: cost, merge: Math.min });
    const next = Snapshot.of(graph, {
      weight: cost,
      merge: Math.min,
      reuse: base,
    });
    expect(next).not.toBe(base);
    expect(next.size).toBe(1);
  });
});

describe("共享内存编译", () => {
  const backing = (list: Iterable<number>): unknown =>
    (list as Int32Array).buffer;

  it("CSR 与权重落在 SharedArrayBuffer 上，算法照跑", () => {
    const graph = randomGraph(91, { order: 30, density: 2 });
    const snapshot = Snapshot.of(graph, { weight: cost, shared: true });

    expect(backing(snapshot.outbound.offset)).toBeInstanceOf(SharedArrayBuffer);
    expect(backing(snapshot.outbound.other)).toBeInstanceOf(SharedArrayBuffer);
    expect(backing(snapshot.inbound!.edge)).toBeInstanceOf(SharedArrayBuffer);
    expect((snapshot.weight as Float64Array).buffer).toBeInstanceOf(
      SharedArrayBuffer,
    );

    const plain = weighted(graph);
    expect(settle(scc(snapshot)).count).toBe(settle(scc(plain)).count);
    expect([...snapshot.weight!]).toEqual([...plain.weight!]);
  });

  it("合并 + 共享的权重仍在 SharedArrayBuffer 上", () => {
    const graph = new Graph<null, number>(graphId("shared-merge"));
    graph.addNode(vertex<null>("a", null));
    graph.addNode(vertex<null>("b", null));
    graph.connect([nodeId("a"), "out"], [nodeId("b"), "in"], { weight: 3 });
    graph.connect([nodeId("a"), "out"], [nodeId("b"), "in"], { weight: 7 });

    const snapshot = Snapshot.of(graph, {
      weight: cost,
      shared: true,
      merge: Math.min,
    });
    expect((snapshot.weight as Float64Array).buffer).toBeInstanceOf(
      SharedArrayBuffer,
    );
    expect([...snapshot.weight!]).toEqual([3]);
  });

  it("共享与非共享互不复用，重算保持原有的底层介质", () => {
    const graph = randomGraph(92, { order: 20, density: 2 });
    const shared = Snapshot.of(graph, { weight: cost, shared: true });
    expect(Snapshot.of(graph, { weight: cost, reuse: shared })).not.toBe(
      shared,
    );
    expect(
      Snapshot.of(graph, { weight: cost, shared: true, reuse: shared }),
    ).toBe(shared);

    graph.setEdgeWeight(graph.edges()[0]!, 42);
    const next = Snapshot.of(graph, {
      weight: cost,
      shared: true,
      reuse: shared,
    });
    expect(next.outbound).toBe(shared.outbound);
    expect((next.weight as Float64Array).buffer).toBeInstanceOf(
      SharedArrayBuffer,
    );
  });
});

describe("搬运数据的形状校验", () => {
  it("字段长度相互矛盾时抛 Schema，而不是给出怪异行为", () => {
    const graph = randomGraph(93, { order: 10, density: 2 });
    const data = weighted(graph).data;

    expect(() => Snapshot.from({ ...data, order: data.order + 1 })).toThrow(
      Schema,
    );
    expect(() =>
      Snapshot.from({ ...data, weight: new Float64Array(1) }),
    ).toThrow(Schema);
    expect(() =>
      Snapshot.from({ ...data, nodes: data.nodes!.slice(0, 1) }),
    ).toThrow(Schema);
    expect(() =>
      Snapshot.from({ ...data, edges: data.edges!.slice(0, 1) }),
    ).toThrow(Schema);
    expect(() =>
      Snapshot.from({
        ...data,
        outbound: {
          ...data.outbound,
          other: data.outbound.other.subarray(0, 1),
        },
      }),
    ).toThrow(Schema);
  });

  it("完好的数据照常通过", () => {
    const graph = randomGraph(94, { order: 10, density: 2 });
    const snapshot = weighted(graph);
    expect(() => Snapshot.from(snapshot.data)).not.toThrow();
    expect(() => Snapshot.from(snapshot.core)).not.toThrow();
  });
});

describe("对源图的弱引用", () => {
  /**
   * 快照常常活得比源图久（缓存在算法层、挂在 UI 状态上）。强引用会把整张图连同全部端口
   * 对象一起钉住——快照自身可能只有几百 KB，钉住的图却是它的几十倍。
   */
  /**
   * 反复让出再触发 GC，直到 `watch` 真的空掉。单次 `gc()` 不保证收走刚失去引用的对象
   * （年轻代还没晋升、栈上仍可能残留引用），只跑一轮会间歇性误报。
   */
  const collect = async (watch?: WeakRef<object>): Promise<void> => {
    const gc = (globalThis as { gc?: () => void }).gc;
    expect(gc, "需要 --expose-gc，见 vitest.config.ts").toBeDefined();
    for (let round = 0; round < 10; round++) {
      await new Promise((resume) => setTimeout(resume, 0));
      gc!();
      if (watch?.deref() === undefined) return;
    }
  };

  it("源图还活着时，陈旧判定照常", () => {
    const graph = randomGraph(70, { order: 20, density: 2 });
    const snapshot = weighted(graph);

    expect(snapshot.current).toBe(true);
    graph.addNode(vertex("extra", 0));
    expect(snapshot.current).toBe(false);
    expect(() => snapshot.verify()).toThrow(Stale);
  });

  it("源图可被回收，快照不再钉住它", async () => {
    let graph: Graph<number, number> | undefined = randomGraph(71, {
      order: 200,
      density: 3,
    });
    const snapshot = weighted(graph);
    const watch = new WeakRef(graph);

    graph = undefined;
    await collect(watch);

    expect(watch.deref()).toBeUndefined();
    // 快照自身完好，索引空间的一切照常。
    expect(snapshot.order).toBe(200);
    expect(settle(scc(snapshot)).count).toBeGreaterThan(0);
  });

  it("源图被回收后，陈旧只在证据确凿时才报", async () => {
    let graph: Graph<number, number> | undefined = randomGraph(72, {
      order: 50,
      density: 2,
    });
    const snapshot = weighted(graph);

    graph = undefined;
    await collect();

    // 无从判定就不判定——与跨线程还原的快照同一口径。
    expect(snapshot.current).toBe(true);
    expect(() => snapshot.verify()).not.toThrow();
  });

  it("源图被回收后，增量复用退回全量而不是出错", async () => {
    const keep = randomGraph(73, { order: 40, density: 2 });
    let gone: Graph<number, number> | undefined = randomGraph(74, {
      order: 40,
      density: 2,
    });
    const orphan = weighted(gone);

    gone = undefined;
    await collect();

    const next = Snapshot.of(keep, { weight: cost, reuse: orphan });
    expect(next.order).toBe(keep.order);
    expect(next.outbound).not.toBe(orphan.outbound);
  });
});

describe("标注层", () => {
  it("默认不编译——不付这份代价的人不该看见它", () => {
    const snapshot = Snapshot.of(router());
    expect(snapshot.layers).toEqual({});
    expect(snapshot.words).toEqual([]);
    // 静默给空会让"这条边没接在任何引脚上"和"你没编译这一层"分不开。
    expect(() => snapshot.layer("source")).toThrow(/was not compiled/);
  });

  it("层名自取，不止端口——内核不认识「端口」这个概念", () => {
    const snapshot = Snapshot.of(router(), {
      layer: { kind: (wire) => (wire.sourcePort === "yes" ? "then" : "else") },
    });
    const kind = snapshot.layer("kind");
    expect([...snapshot.words].sort()).toEqual(["else", "then"]);
    expect(snapshot.word(kind[0]!)).toBe("then");
    expect(() => snapshot.layer("source")).toThrow(/was not compiled/);
  });

  it("编译后能在索引空间按引脚分派分支", () => {
    const snapshot = Snapshot.of(router(), { layer: PORTS });
    expect(branch(snapshot, nodeId("a"), "yes")).toEqual([nodeId("b")]);
    expect(branch(snapshot, nodeId("a"), "no")).toEqual([nodeId("c")]);
    expect(branch(snapshot, nodeId("b"), "yes")).toEqual([]);
  });

  it("名字表按种类去重，不随边数增长", () => {
    const graph = new Graph<number, number>(graphId("fan"));
    graph.addNode(branching("hub"));
    for (let i = 0; i < 50; i++) {
      graph.addNode(branching(`n${i}`));
      // `yes` 是 multiple:false，扇出走 `no` 之外的一条：这里让每个目标各连一次 in。
      graph.connect([nodeId(`n${i}`), "yes"], [nodeId("hub"), "in"]);
    }
    const snapshot = Snapshot.of(graph, { layer: PORTS });
    expect(snapshot.size).toBe(50);
    // 50 条边，只用到 `yes` 与 `in` 两个名字。
    expect([...snapshot.words].sort()).toEqual(["in", "yes"]);
    expect(snapshot.code("nope")).toBe(-1);
  });

  it("每条边的两端各记各的", () => {
    const snapshot = Snapshot.of(router(), { layer: PORTS });
    for (let e = 0; e < snapshot.size; e++) {
      const record = router().edge(snapshot.edges[e]!)!;
      expect(snapshot.word(snapshot.layer("source")[e]!)).toBe(record.sourcePort);
      expect(snapshot.word(snapshot.layer("target")[e]!)).toBe(record.targetPort);
    }
  });

  it("标注层跟着 core 走，Worker 侧拿得到引脚名", () => {
    const snapshot = Snapshot.of(router(), { layer: PORTS });
    // core 刻意不带 O(V)/O(E) 的 id 标签，但标注层要留下：编号是 typed-array，
    // 名字表的长度是引脚种类数。
    const revived = Snapshot.from(structuredClone(snapshot.core));
    expect(revived.nodes).toEqual([]);
    expect(revived.word(revived.layer("source")[0]!)).toBe("yes");
    expect(revived.code("no")).toBe(snapshot.code("no"));
  });

  it("翻转方向不动端口——端口属于边，不属于方向", () => {
    const snapshot = Snapshot.of(router(), { layer: PORTS });
    const back = snapshot.reverse();
    for (let e = 0; e < snapshot.size; e++) {
      expect(back.word(back.layer("source")[e]!)).toBe(snapshot.word(snapshot.layer("source")[e]!));
      expect(back.word(back.layer("target")[e]!)).toBe(snapshot.word(snapshot.layer("target")[e]!));
    }
  });

  it("合并平行边时端口取首条，与边 id 同一口径", () => {
    const graph = new Graph<number, number>(graphId("parallel"));
    for (const name of ["a", "b"]) graph.addNode(branching(name));
    const first = graph.connect([nodeId("a"), "yes"], [nodeId("b"), "in"], {
      weight: 5,
    });
    graph.connect([nodeId("a"), "no"], [nodeId("b"), "in"], { weight: 2 });

    const snapshot = Snapshot.of(graph, {
      layer: PORTS,
      weight: (w) => w ?? 1,
      merge: Math.min,
    });
    expect(snapshot.size).toBe(1);
    expect(snapshot.edges[0]).toBe(first);
    expect(snapshot.word(snapshot.layer("source")[0]!)).toBe("yes");
    expect(snapshot.weight![0]).toBe(2);
  });

  it("折叠分组后跨组边保留原来的引脚", () => {
    const graph = router();
    graph.addNode(branching("box"));
    graph.setParent(nodeId("b"), nodeId("box"));

    const snapshot = Snapshot.of(graph, {
      layer: PORTS,
      collapse: [nodeId("box")],
    });
    // a --yes--> b 被抬到 box 上，引脚名不变。
    expect(branch(snapshot, nodeId("a"), "yes")).toEqual([nodeId("box")]);
  });

  it("增量重编译复用标注层，只重算权重", () => {
    const graph = router();
    graph.setEdgeWeight(graph.edges()[0]!, 3);
    const first = Snapshot.of(graph, { layer: PORTS, weight: (w) => w ?? 1 });
    graph.setEdgeWeight(graph.edges()[0]!, 9);
    const second = Snapshot.of(graph, {
      layer: PORTS,
      weight: (w) => w ?? 1,
      reuse: first,
    });

    expect(second).not.toBe(first);
    expect(second.outbound).toBe(first.outbound);
    expect(second.layer("source")).toBe(first.layer("source"));
    expect(second.words).toBe(first.words);
    expect(second.weight![0]).toBe(9);
  });

  it("配方不一致时不复用——否则会拿到一份没有标注层的快照", () => {
    const graph = router();
    const bare = Snapshot.of(graph);
    const withPorts = Snapshot.of(graph, { layer: PORTS, reuse: bare });
    expect(() => withPorts.layer("source")).not.toThrow();
  });
});

describe("搬运数据的校验", () => {
  const sample = (): Snapshot => Snapshot.of(router(), { layer: PORTS });

  it("标注编号越出名字表时报错", () => {
    const data = sample().core;
    const broken = Int32Array.from(data.layers!.source!);
    broken[0] = 99;
    expect(() =>
      Snapshot.from({ ...data, layers: { ...data.layers, source: broken } }),
    ).toThrow(Schema);
  });

  it("标注编号数组长度与边数对不上时报错", () => {
    const data = sample().core;
    expect(() =>
      Snapshot.from({
        ...data,
        layers: { ...data.layers, source: Int32Array.of(0) },
      }),
    ).toThrow(Schema);
  });

  it("邻接里的节点下标越界时报错，而不是静默算出错答案", () => {
    const data = sample().core;
    const other = Int32Array.from(data.outbound.other);
    other[0] = data.order + 5;
    expect(() =>
      Snapshot.from({ ...data, outbound: { ...data.outbound, other } }),
    ).toThrow(Schema);
  });

  it("邻接里的边序号越界时报错", () => {
    const data = sample().core;
    const edge = Int32Array.from(data.outbound.edge);
    edge[0] = data.size + 5;
    expect(() =>
      Snapshot.from({ ...data, outbound: { ...data.outbound, edge } }),
    ).toThrow(Schema);
  });

  it("offset 非单调时报错", () => {
    const data = sample().core;
    const offset = Int32Array.from(data.outbound.offset);
    offset[1] = -1;
    expect(() =>
      Snapshot.from({ ...data, outbound: { ...data.outbound, offset } }),
    ).toThrow(Schema);
  });
});

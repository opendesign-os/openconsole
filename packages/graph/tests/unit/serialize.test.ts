import { describe, expect, it, vi } from "vitest";

import {
  apply,
  compression,
  diff,
  Graph,
  graphId,
  invert,
  Missing,
  nodeId,
  pack,
  Port,
  Schema,
  Socket,
  unpack,
  Vertex,
  type Bundle,
  type Sockets,
} from "../../index";
import { randomGraph, vertex } from "../support";

/** 与写出顺序无关的内容指纹；图 id 单独断言。 */
function canonical(graph: Graph<number, number>): string {
  const { compact } = pack(graph);
  const byId = (a: readonly unknown[], b: readonly unknown[]): number =>
    String(a[0]).localeCompare(String(b[0]));
  return JSON.stringify({
    n: [...compact.n].sort(byId),
    e: [...compact.e].sort(byId),
    h: [...(compact.h ?? [])].map(String).sort(),
  });
}

/** 带端口约束与两层嵌套的图，覆盖格式里所有可选字段。 */
function decorated(): Graph<number, number> {
  const graph = randomGraph(51, { order: 15, density: 2 });
  graph.addNode(
    new Vertex<Sockets, Sockets, number>(nodeId("special"), 99)
      .addInput("typed", Socket.number, {
        multiple: false,
        required: true,
        fallback: 42,
      })
      .addOutput("out", Socket.string),
  );
  graph.setParent(nodeId("n1"), nodeId("n0"));
  graph.setParent(nodeId("n2"), nodeId("n1"));
  return graph;
}

describe("紧凑格式", () => {
  it("往返守恒结构、权重、端口约束与层级", () => {
    const graph = decorated();
    const restored = unpack<number, number>(pack(graph));

    expect(canonical(restored)).toBe(canonical(graph));
    const port = restored.node(nodeId("special"))!.inputs["typed"]!;
    expect(port.socket.name).toBe("number");
    expect(port.multiple).toBe(false);
    expect(port.required).toBe(true);
    expect(port.fallback).toBe(42);
    expect(restored.parent(nodeId("n2"))).toBe(nodeId("n1"));
  });

  it("按给定顺序写出节点", () => {
    const graph = randomGraph(52, { order: 8, density: 1 });
    const order = graph.nodes().slice().reverse();
    const { compact } = pack(graph, { order });
    expect(compact.n.map((entry) => entry[0])).toEqual(order);
  });

  /**
   * 漏节点会让边引用到不存在的端点、重复节点会撞 `Duplicate`——两者都要到 unpack
   * 才在远处炸。错误应落在出错的地方，故 pack 先按计数兜住。
   */
  it("order 没一一覆盖节点时抛 Schema，不认识的 id 忽略", () => {
    const graph = randomGraph(58, { order: 5, density: 1 });
    const ids = graph.nodes();

    expect(() => pack(graph, { order: ids.slice(1) })).toThrow(Schema);
    expect(() => pack(graph, { order: [...ids, ids[0]!] })).toThrow(Schema);
    expect(() =>
      pack(graph, { order: [...ids, nodeId("ghost")] }),
    ).not.toThrow();
  });

  /**
   * JSON 会把数组里的 `undefined` 写成 `null`。权重位靠"省略"而不是占位来表达
   * "没有权重"，两种取值经 JSON 往返后才互不串味。
   */
  it("undefined 权重经 JSON 往返仍是 undefined，null 权重保留为 null", () => {
    const graph = new Graph<number | null, number | null>(graphId("json"));
    graph.addNode(vertex<number | null>("bare"));
    graph.addNode(vertex<number | null>("nil", null));
    graph.connect([nodeId("bare"), "out"], [nodeId("nil"), "in"]);

    const wire = JSON.parse(JSON.stringify(pack(graph))) as Bundle<
      number | null,
      number | null
    >;
    const restored = unpack<number | null, number | null>(wire);

    expect(restored.hasNode(nodeId("bare"))).toBe(true);
    expect(restored.nodeWeight(nodeId("bare"))).toBeUndefined();
    expect(restored.nodeWeight(nodeId("nil"))).toBeNull();
    expect(restored.edgeWeight(restored.edges()[0]!)).toBeUndefined();
  });

  it("intern 把长 id 换成短整数并能还原", () => {
    const graph = decorated();
    const bundle = pack(graph, { intern: true });

    expect(bundle.ids).toBeDefined();
    expect(bundle.compact.n[0]![0]).toBe("0");
    expect(canonical(unpack<number, number>(bundle))).toBe(canonical(graph));
  });

  it("revive: false 保留短 id", () => {
    const graph = randomGraph(53, { order: 6, density: 1 });
    const short = unpack<number, number>(pack(graph, { intern: true }), {
      revive: false,
    });

    expect(short.hasNode(nodeId("0"))).toBe(true);
    expect(short.hasNode(nodeId("n0"))).toBe(false);
    expect(short.order).toBe(graph.order);
  });

  it("写入已有的图会先清空它，但保留目标图自己的 id", () => {
    const graph = randomGraph(54, { order: 8, density: 1 });
    const target = randomGraph(55, { order: 30, density: 2 });
    unpack(pack(graph), { into: target });

    expect(canonical(target)).toBe(canonical(graph));
    expect(target.id).toBe(graphId("seed-55"));
  });

  it("版本不匹配抛 Schema", () => {
    const { compact } = pack(randomGraph(56, { order: 4 }));
    expect(() => unpack({ compact: { ...compact, v: 99 } })).toThrow(Schema);
  });

  it("自定义 socket 经 sockets 选项还原，缺表则明确报错", () => {
    const exotic = new Socket("exotic");
    const graph = new Graph<number, number>(graphId("custom"));
    graph.addNode(
      new Vertex<Sockets, Sockets, number>(nodeId("a"), 1).addOutput(
        "out",
        exotic,
      ),
    );
    const bundle = pack(graph);

    const restored = unpack<number, number>(bundle, { sockets: [exotic] });
    expect(restored.node(nodeId("a"))!.outputs["out"]!.socket).toBe(exotic);

    expect(() => unpack(bundle)).toThrow(Missing);
    expect(() => unpack(bundle)).toThrow(/socket "exotic"/);
  });

  it("紧凑格式确实比展开 JSON 小", () => {
    const report = compression(decorated());
    expect(report.ratio).toBeGreaterThan(1.5);
    expect(report.packed).toBeLessThan(report.original);
  });
});

describe("结构化差异", () => {
  it("apply 把 before 变成 after，invert 再变回来", () => {
    const before = decorated();
    const after = before.copy();

    after.dropNode(nodeId("n3"));
    after.addNode(vertex("fresh", 7));
    after.connect([nodeId("fresh"), "out"], [nodeId("n0"), "in"], {
      weight: 5,
    });
    after.setWeight(nodeId("n0"), 1000);
    after.setParent(nodeId("n4"), nodeId("n0"));
    after.unparent(nodeId("n2"));

    const changes = diff(before, after);
    const target = before.copy();

    apply(target, changes);
    expect(canonical(target)).toBe(canonical(after));
    apply(target, invert(changes));
    expect(canonical(target)).toBe(canonical(before));
  });

  it("只改权重时不产生结构变更", () => {
    const before = randomGraph(57, { order: 10, density: 2 });
    const after = before.copy();
    after.setWeight(nodeId("n0"), 12345);

    const changes = diff(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "weighNode", to: 12345 });
  });

  it("两个相同的图没有差异", () => {
    const graph = decorated();
    expect(diff(graph, graph.copy())).toEqual([]);
  });
});

describe("端口结构变了的节点按删除加重建处理", () => {
  it("连带重建那些边", () => {
    const before = new Graph<number, number>(graphId("ports"));
    before.addNode(vertex("a", 1));
    before.addNode(vertex("b", 2));
    before.connect([nodeId("a"), "out"], [nodeId("b"), "in"]);

    const after = before.copy();
    after.reshape(nodeId("a"), { inputs: { in: new Port(Socket.number) } });

    const changes = diff(before, after);
    expect(changes.some((change) => change.kind === "dropNode")).toBe(true);
    expect(changes.some((change) => change.kind === "addNode")).toBe(true);

    const target = before.copy();
    apply(target, changes);
    expect(canonical(target)).toBe(canonical(after));
  });

  /**
   * `dropNode` 会把子节点提升到祖父。若 `diff` 因为"前后父节点一致"而不产出 reparent，
   * 改了端口的分组就会丢掉整棵子树；`invert` 只是倒序，因此撤销方向也得一并守住。
   */
  const nested = (): [Graph<number, number>, Graph<number, number>] => {
    const before = new Graph<number, number>(graphId("nest"));
    before.addNode(vertex("group", 1));
    before.addNode(vertex("child", 2));
    before.addNode(vertex("leaf", 3));
    before.setParent(nodeId("child"), nodeId("group"));
    before.setParent(nodeId("leaf"), nodeId("child"));

    const after = before.copy();
    after.reshape(nodeId("group"), { outputs: {} });
    return [before, after];
  };

  it("子树父链在 apply 之后仍在", () => {
    const [before, after] = nested();
    const target = before.copy();
    apply(target, diff(before, after));

    expect(target.parent(nodeId("child"))).toBe(nodeId("group"));
    expect(target.parent(nodeId("leaf"))).toBe(nodeId("child"));
  });

  it("撤销方向同样守恒", () => {
    const [before, after] = nested();
    const changes = diff(before, after);
    const target = before.copy();

    apply(target, changes);
    apply(target, invert(changes));

    expect(target.parent(nodeId("child"))).toBe(nodeId("group"));
    expect(target.parent(nodeId("leaf"))).toBe(nodeId("child"));
    expect(target.node(nodeId("group"))!.outputs["out"]).toBeDefined();
  });
});

describe("端口等价判定", () => {
  /**
   * 这层判定决定 `diff` 把节点看成"改了形状"（删除 + 重建）还是"没动"。原先是把两边各
   * `JSON.stringify` 一遍比字符串，现在逐字段比——口径必须逐项对齐，任何一维漏判都会让
   * 补丁少一次重建或多一次重建。
   */
  const withPort = (port: Port): Graph<number, number> => {
    const graph = new Graph<number, number>(graphId("p"));
    graph.addNode({ id: nodeId("a"), weight: 1, inputs: { in: port } });
    return graph;
  };

  const changed = (left: Port, right: Port): boolean =>
    diff(withPort(left), withPort(right)).some(
      (change) => change.kind === "addNode",
    );

  it("socket 名不同算改了形状", () => {
    expect(changed(new Port(Socket.number), new Port(Socket.string))).toBe(
      true,
    );
    expect(changed(new Port(Socket.number), new Port(Socket.number))).toBe(
      false,
    );
  });

  it("multiple / required 各自独立参与判定", () => {
    const base = new Port(Socket.any);
    expect(changed(base, new Port(Socket.any, { multiple: false }))).toBe(true);
    expect(changed(base, new Port(Socket.any, { required: true }))).toBe(true);
  });

  it("fallback 按结构比，等值的不同实例不算改动", () => {
    const one = new Port(Socket.any, { fallback: { x: 1 } });
    const same = new Port(Socket.any, { fallback: { x: 1 } });
    const other = new Port(Socket.any, { fallback: { x: 2 } });

    expect(changed(one, same)).toBe(false);
    expect(changed(one, other)).toBe(true);
    expect(changed(new Port(Socket.any), one)).toBe(true);
  });

  it("多一个或少一个端口都算改了形状", () => {
    const before = new Graph<number, number>(graphId("p"));
    before.addNode({
      id: nodeId("a"),
      weight: 1,
      inputs: { in: new Port(Socket.any) },
    });
    const after = before.copy();
    after.reshape(nodeId("a"), {
      inputs: { in: new Port(Socket.any), extra: new Port(Socket.any) },
    });

    expect(diff(before, after).some((c) => c.kind === "addNode")).toBe(true);
    expect(diff(after, before).some((c) => c.kind === "addNode")).toBe(true);
  });

  it("端口表里取值为 undefined 的键不参与比较", () => {
    const before = new Graph<number, number>(graphId("p"));
    before.addNode({
      id: nodeId("a"),
      weight: 1,
      inputs: { in: new Port(Socket.any) },
    });
    const after = new Graph<number, number>(graphId("p"));
    after.addNode({
      id: nodeId("a"),
      weight: 1,
      inputs: { in: new Port(Socket.any), ghost: undefined },
    });

    expect(diff(before, after)).toEqual([]);
  });

  it("端点变了的边按重建处理，端点没变的只记权重", () => {
    const before = new Graph<number, number>(graphId("e"));
    for (const name of ["a", "b", "c"]) before.addNode(vertex(name, 0));
    const edge = before.connect([nodeId("a"), "out"], [nodeId("b"), "in"], {
      weight: 1,
    });

    const moved = before.copy();
    moved.disconnect(edge);
    moved.connect([nodeId("a"), "out"], [nodeId("c"), "in"], {
      id: edge,
      weight: 1,
    });
    expect(
      diff(before, moved)
        .map((c) => c.kind)
        .sort(),
    ).toEqual(["addEdge", "dropEdge"]);

    const reweighed = before.copy();
    reweighed.setEdgeWeight(edge, 9);
    expect(diff(before, reweighed).map((c) => c.kind)).toEqual(["weighEdge"]);
  });
});

describe("diff 不为每个节点付固定重成本", () => {
  /**
   * 判断"有没有节点改了形状"曾经是把两边各 `JSON.stringify` 一遍再比字符串——次数是 2V，
   * 与图上真正改了多少东西无关。V=4000 上改一个权重要 36ms，编辑器里做实时 diff 不可用。
   *
   * 这里数调用次数而不是计时：旧写法也是 O(V)、只是常数大，规模比与耗时比都分辨不出退化，
   * 唯有"序列化了多少次"是精确且与机器无关的。
   */
  it("单点权重改动一次 JSON.stringify 都不做", () => {
    const before = randomGraph(81, { order: 400, density: 2 });
    const after = before.copy();
    after.setWeight(nodeId("n0"), 12345);

    const spy = vi.spyOn(JSON, "stringify");
    let calls = 0;
    let changes;
    try {
      changes = diff(before, after);
      calls = spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }

    expect(changes).toHaveLength(1);
    // 逐节点序列化时这里是 2V = 800 次。
    expect(calls).toBe(0);
  });

  it("只有对象型权重 / fallback 才按需序列化，次数随改动量而非图规模走", () => {
    const before = new Graph<Record<string, number>, number>(graphId("obj"));
    for (let i = 0; i < 200; i++) {
      before.addNode({ id: nodeId(`n${i}`), weight: { v: i } });
    }
    const after = before.copy();
    after.setWeight(nodeId("n7"), { v: 999 });

    const spy = vi.spyOn(JSON, "stringify");
    let calls = 0;
    try {
      expect(diff(before, after)).toHaveLength(1);
      calls = spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }

    // 权重是对象，`Object.is` 短路不掉，但只有真正不等的那一对才走到序列化。
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThan(before.order);
  });
});

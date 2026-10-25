import { describe, expect, it, vi } from "vitest";

import {
  Capacity,
  Graph,
  graphId,
  Missing,
  nodeId,
  Port,
  Socket,
  Vertex,
  type NodeId,
  type Ports,
  type Sockets,
} from "../../index";

const exec = (multiple: boolean): Port => new Port(Socket.exec, { multiple });
const data = (socket: Socket, multiple: boolean): Port =>
  new Port(socket, { multiple });

/** 蓝图形态：exec 输出单连、exec 输入多连、data 输出多连、data 输入单连。 */
function blueprint(): Graph<string, void> {
  const graph = new Graph<string, void>(graphId("blueprint"));
  graph.addNode({
    id: nodeId("start"),
    weight: "Event",
    outputs: { then: exec(false) },
  });
  graph.addNode({
    id: nodeId("branch"),
    weight: "Branch",
    inputs: { exec: exec(true), condition: data(Socket.boolean, false) },
    outputs: { true: exec(false), false: exec(false) },
  });
  graph.addNode({
    id: nodeId("compare"),
    weight: "Greater",
    inputs: { a: data(Socket.number, false), b: data(Socket.number, false) },
    outputs: { result: data(Socket.boolean, true) },
  });
  for (const name of ["yes", "no"]) {
    graph.addNode({
      id: nodeId(name),
      weight: "Print",
      inputs: { exec: exec(true) },
      outputs: { then: exec(false) },
    });
  }

  graph.connect([nodeId("start"), "then"], [nodeId("branch"), "exec"]);
  graph.connect([nodeId("compare"), "result"], [nodeId("branch"), "condition"]);
  graph.connect([nodeId("branch"), "true"], [nodeId("yes"), "exec"]);
  graph.connect([nodeId("branch"), "false"], [nodeId("no"), "exec"]);
  return graph;
}

describe("引脚容量", () => {
  it("单连接输出拒绝第二条边", () => {
    const graph = blueprint();
    expect(() =>
      graph.connect([nodeId("branch"), "true"], [nodeId("no"), "exec"]),
    ).toThrow(Capacity);
  });

  it("多连接输入接受分支汇聚", () => {
    const graph = blueprint();
    graph.addNode({ id: nodeId("join"), inputs: { exec: exec(true) } });
    graph.connect([nodeId("yes"), "then"], [nodeId("join"), "exec"]);
    graph.connect([nodeId("no"), "then"], [nodeId("join"), "exec"]);
    expect(graph.inDegree(nodeId("join"))).toBe(2);
  });

  it("data 输出可扇出，data 输入只收一路", () => {
    const graph = blueprint();
    graph.addNode({
      id: nodeId("also"),
      inputs: { flag: data(Socket.boolean, false) },
    });
    graph.connect([nodeId("compare"), "result"], [nodeId("also"), "flag"]);
    expect(graph.outDegree(nodeId("compare"))).toBe(2);

    graph.addNode({
      id: nodeId("other"),
      outputs: { result: data(Socket.boolean, true) },
    });
    expect(() =>
      graph.connect([nodeId("other"), "result"], [nodeId("also"), "flag"]),
    ).toThrow(Capacity);
  });
});

describe("按引脚查边", () => {
  it("target / source 取指定引脚的对端", () => {
    const graph = blueprint();
    expect(graph.target(nodeId("start"), "then")).toBe(nodeId("branch"));
    expect(graph.target(nodeId("branch"), "true")).toBe(nodeId("yes"));
    expect(graph.target(nodeId("branch"), "false")).toBe(nodeId("no"));
    expect(graph.source(nodeId("branch"), "condition")).toBe(nodeId("compare"));
    expect(graph.source(nodeId("branch"), "exec")).toBe(nodeId("start"));
  });

  it("未连接的引脚、未知端口、未知节点都返回 undefined", () => {
    const graph = blueprint();
    expect(graph.source(nodeId("compare"), "a")).toBeUndefined();
    expect(graph.target(nodeId("start"), "missing")).toBeUndefined();
    expect(graph.target(nodeId("ghost"), "then")).toBeUndefined();
  });

  it("多连接引脚上 linkedTo 给其中一条，forEachOut 给全部", () => {
    const graph = blueprint();
    graph.addNode({
      id: nodeId("also"),
      inputs: { flag: data(Socket.boolean, false) },
    });
    graph.connect([nodeId("compare"), "result"], [nodeId("also"), "flag"]);

    expect(graph.target(nodeId("compare"), "result")).toBe(nodeId("branch"));
    const targets: NodeId[] = [];
    graph.forEachOut(nodeId("compare"), (target, _edge, port) => {
      if (port === "result") targets.push(target);
    });
    expect(targets).toEqual([nodeId("branch"), nodeId("also")]);
  });

  it("forEach 的 port 是本端引脚名", () => {
    const graph = blueprint();
    const out: string[] = [];
    graph.forEachOut(nodeId("branch"), (_target, _edge, port) => {
      out.push(port);
    });
    expect(out.sort()).toEqual(["false", "true"]);

    const into: string[] = [];
    graph.forEachIn(nodeId("branch"), (_source, _edge, port) => {
      into.push(port);
    });
    expect(into.sort()).toEqual(["condition", "exec"]);
  });
});

describe("reshape", () => {
  const branch = nodeId("branch");

  it("加引脚不动现有连线", () => {
    const graph = blueprint();
    const before = graph.size;
    graph.reshape(branch, {
      inputs: {
        exec: exec(true),
        condition: data(Socket.boolean, false),
        fallthrough: exec(true),
      },
    });

    expect(graph.size).toBe(before);
    expect(graph.node(branch)!.inputs["fallthrough"]).toBeDefined();
    expect(graph.source(branch, "condition")).toBe(nodeId("compare"));
  });

  it("删引脚只断该引脚上的边", () => {
    const graph = blueprint();
    graph.reshape(branch, { outputs: { true: exec(false) } });

    expect(graph.target(branch, "true")).toBe(nodeId("yes"));
    expect(graph.target(branch, "false")).toBeUndefined();
    expect(graph.inDegree(nodeId("no"))).toBe(0);
  });

  it("Socket 变得不兼容时断边，仍兼容则保留", () => {
    const broken = blueprint();
    broken.reshape(nodeId("compare"), {
      outputs: { result: data(Socket.string, true) },
    });
    expect(broken.target(nodeId("compare"), "result")).toBeUndefined();

    const kept = blueprint();
    kept.reshape(nodeId("compare"), {
      outputs: { result: data(Socket.any, true) },
    });
    expect(kept.target(nodeId("compare"), "result")).toBe(branch);
  });

  it("容量收紧为单连接时保留最早那条", () => {
    const graph = new Graph<void, void>(graphId("narrow"));
    graph.addNode({
      id: nodeId("hub"),
      outputs: { out: data(Socket.number, true) },
    });
    for (const name of ["a", "b", "c"]) {
      graph.addNode({
        id: nodeId(name),
        inputs: { in: data(Socket.number, false) },
      });
      graph.connect([nodeId("hub"), "out"], [nodeId(name), "in"]);
    }

    graph.reshape(nodeId("hub"), {
      outputs: { out: data(Socket.number, false) },
    });
    expect(graph.outDegree(nodeId("hub"))).toBe(1);
    expect(graph.target(nodeId("hub"), "out")).toBe(nodeId("a"));
  });

  it("省略的一侧保持不变", () => {
    const graph = blueprint();
    graph.reshape(branch, { outputs: { true: exec(false) } });

    expect(Object.keys(graph.node(branch)!.inputs).sort()).toEqual([
      "condition",
      "exec",
    ]);
    expect(graph.source(branch, "exec")).toBe(nodeId("start"));
  });

  it("派发 nodeReshaped 与被断边的 edgeDropped，事务里推迟到末尾", () => {
    const graph = blueprint();
    const reshaped = vi.fn();
    graph.signal.on("nodeReshaped", reshaped);
    const order: string[] = [];
    graph.signal.on("*", (type) => order.push(type));

    graph.batch(() => {
      graph.reshape(branch, { outputs: { true: exec(false) } });
      expect(order).toHaveLength(0);
    });

    expect(order).toEqual(["edgeDropped", "nodeReshaped", "flushed"]);
    const payload = reshaped.mock.calls[0]![0] as {
      node: NodeId;
      outputs: Ports;
    };
    expect(payload.node).toBe(branch);
    expect(Object.keys(payload.outputs)).toEqual(["true"]);
  });

  it("清空两侧引脚断掉全部连线，但节点还在，且还能重新连", () => {
    const graph = blueprint();
    graph.reshape(branch, { inputs: {}, outputs: {} });

    expect(graph.hasNode(branch)).toBe(true);
    expect(graph.degree(branch)).toBe(0);
    expect(graph.size).toBe(0);

    graph.reshape(branch, { outputs: { always: exec(false) } });
    graph.connect([branch, "always"], [nodeId("yes"), "exec"]);
    expect(graph.target(branch, "always")).toBe(nodeId("yes"));
  });

  it("节点不存在时抛 Missing", () => {
    expect(() => blueprint().reshape(nodeId("ghost"), { inputs: {} })).toThrow(
      Missing,
    );
  });

  it("Vertex 模板可直接作为入参", () => {
    const graph = blueprint();
    graph.reshape(
      branch,
      new Vertex<Sockets, Sockets, string>(branch)
        .addOutput("true", Socket.exec)
        .addOutput("false", Socket.exec)
        .addOutput("done", Socket.exec),
    );

    expect(Object.keys(graph.node(branch)!.outputs).sort()).toEqual([
      "done",
      "false",
      "true",
    ]);
  });

  /**
   * `Vertex` 是可复用的可变模板，`removeInput` / `removeOutput` 是 `addInput` /
   * `addOutput` 的另一半：在模板上摘掉引脚再 `reshape`，等价于声明一个更窄的形状。
   */
  it("模板上摘掉引脚，reshape 后该引脚的连线随之断开", () => {
    const graph = blueprint();
    expect(graph.target(branch, "false")).toBeDefined();

    const template = new Vertex<Sockets, Sockets, string>(branch)
      .addOutput("true", Socket.exec)
      .addOutput("false", Socket.exec)
      // 摘一个本来就没有的引脚只是无事发生，链式不断。
      .removeOutput("false")
      .removeOutput("nope");

    expect(Object.keys(template.outputs)).toEqual(["true"]);
    graph.reshape(branch, template);
    expect(Object.keys(graph.node(branch)!.outputs)).toEqual(["true"]);
    expect(graph.target(branch, "false")).toBeUndefined();
  });

  it("removeInput 同理，摘掉之后还能加回来", () => {
    const template = new Vertex<Sockets, Sockets, string>(nodeId("t"))
      .addInput("keep", Socket.exec)
      .addInput("drop", Socket.number)
      .removeInput("drop");

    expect(Object.keys(template.inputs)).toEqual(["keep"]);

    // 模板不持有任何连接状态，改它随时安全。
    template.addInput("drop", Socket.string);
    expect(template.inputs["drop"]!.socket).toBe(Socket.string);
  });
});

describe("上层编排形态", () => {
  it("蓝图：沿 exec 引脚单步走出一条执行路径", () => {
    const graph = blueprint();
    graph.addNode({ id: nodeId("end"), inputs: { exec: exec(true) } });
    graph.connect([nodeId("yes"), "then"], [nodeId("end"), "exec"]);

    const trail: NodeId[] = [];
    let cursor: NodeId | undefined = nodeId("start");
    let pin = "then";
    while (cursor !== undefined) {
      trail.push(cursor);
      const next: NodeId | undefined = graph.target(cursor, pin);
      if (next === undefined) break;
      cursor = next;
      pin = graph.nodeWeight(cursor) === "Branch" ? "true" : "then";
    }

    expect(trail).toEqual(["start", "branch", "yes", "end"].map(nodeId));
  });

  it("蓝图：data 引脚上游可递归拉取", () => {
    const graph = blueprint();
    graph.addNode({
      id: nodeId("five"),
      weight: "Literal",
      outputs: { value: data(Socket.number, true) },
    });
    graph.connect([nodeId("five"), "value"], [nodeId("compare"), "a"]);

    const pull = (node: NodeId, port: string): NodeId[] => {
      const source = graph.source(node, port);
      if (source === undefined) return [];
      const upstream: NodeId[] = [source];
      graph.forEachIn(source, (from) => void upstream.push(from));
      return upstream;
    };

    expect(pull(nodeId("branch"), "condition")).toEqual([
      nodeId("compare"),
      nodeId("five"),
    ]);
    expect(pull(nodeId("compare"), "b")).toEqual([]);
  });

  it("Node-RED：无类型校验、索引引脚、反馈环合法", () => {
    const graph = new Graph<string, void>(graphId("nodered"));
    const wires = (count: number): Ports =>
      Object.fromEntries(
        Array.from({ length: count }, (_, i) => [
          String(i),
          new Port(Socket.any),
        ]),
      );

    graph.addNode({ id: nodeId("inject"), outputs: wires(1) });
    graph.addNode({ id: nodeId("fn"), inputs: wires(1), outputs: wires(2) });
    graph.addNode({ id: nodeId("debug"), inputs: wires(1) });

    graph.connect([nodeId("inject"), "0"], [nodeId("fn"), "0"]);
    graph.connect([nodeId("fn"), "0"], [nodeId("debug"), "0"]);
    graph.connect([nodeId("fn"), "1"], [nodeId("fn"), "0"]);

    expect(graph.target(nodeId("fn"), "1")).toBe(nodeId("fn"));
    expect(graph.size).toBe(3);
  });

  it("n8n：扇出多个下游，输入引脚合并多路", () => {
    const graph = new Graph<string, void>(graphId("n8n"));
    const main = (): Ports => ({ main: new Port(Socket.object) });

    graph.addNode({ id: nodeId("trigger"), outputs: main() });
    for (const name of ["http", "sheet"]) {
      graph.addNode({ id: nodeId(name), inputs: main(), outputs: main() });
      graph.connect([nodeId("trigger"), "main"], [nodeId(name), "main"]);
    }
    graph.addNode({ id: nodeId("merge"), inputs: main() });
    graph.connect([nodeId("http"), "main"], [nodeId("merge"), "main"]);
    graph.connect([nodeId("sheet"), "main"], [nodeId("merge"), "main"]);

    expect(graph.outDegree(nodeId("trigger"))).toBe(2);
    expect(graph.inDegree(nodeId("merge"))).toBe(2);
  });

  it("动态增减引脚数是三形态共同动作", () => {
    const graph = new Graph<string, void>(graphId("dynamic"));
    graph.addNode({
      id: nodeId("switch"),
      outputs: { "0": new Port(Socket.any) },
    });
    for (const name of ["a", "b"]) {
      graph.addNode({ id: nodeId(name), inputs: { in: new Port(Socket.any) } });
    }
    const kept = graph.connect([nodeId("switch"), "0"], [nodeId("a"), "in"]);

    graph.reshape(nodeId("switch"), {
      outputs: { "0": new Port(Socket.any), "1": new Port(Socket.any) },
    });
    graph.connect([nodeId("switch"), "1"], [nodeId("b"), "in"]);

    expect(graph.hasEdge(kept)).toBe(true);
    expect(graph.outDegree(nodeId("switch"))).toBe(2);
  });
});

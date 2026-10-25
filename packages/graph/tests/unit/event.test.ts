import { describe, expect, it, vi } from "vitest";

import { Graph, graphId, nodeId } from "../../index";
import { vertex } from "../support";

const blank = (): Graph<string, number> => new Graph(graphId("t"));
const a = nodeId("a");
const b = nodeId("b");
const c = nodeId("c");

/** 记录派发到的事件类型；`flushed` 是事务边界信号，多数用例不关心。 */
function record(graph: Graph<string, number>, boundaries = true): string[] {
  const seen: string[] = [];
  graph.signal.on("*", (type) => {
    if (boundaries || type !== "flushed") seen.push(type);
  });
  return seen;
}

describe("变更事件", () => {
  it("增删改与层级变更都派发", () => {
    const graph = blank();
    const seen = record(graph, false);

    graph.addNode(vertex("a", "A"));
    graph.addNode(vertex("b"));
    const edge = graph.connect([a, "out"], [b, "in"]);
    graph.setWeight(a, "B");
    graph.setEdgeWeight(edge, 3);
    graph.setParent(b, a);
    graph.unparent(b);
    graph.disconnect(edge);
    graph.dropNode(a);

    expect(seen).toEqual([
      "nodeAdded",
      "nodeAdded",
      "edgeAdded",
      "nodeUpdated",
      "edgeUpdated",
      "parentChanged",
      "parentChanged",
      "edgeDropped",
      "nodeDropped",
    ]);
  });

  it("载荷带足撤销所需的前后值", () => {
    const graph = blank();
    const dropped = vi.fn();
    graph.signal.on("edgeDropped", dropped);
    graph.addNode(vertex("a"));
    graph.addNode(vertex("b"));
    const edge = graph.connect([a, "out"], [b, "in"], { weight: 7 });
    graph.disconnect(edge);

    expect(dropped).toHaveBeenCalledWith({
      edge,
      slot: 0,
      source: a,
      target: b,
      weight: 7,
    });
  });

  it("compact 派发旧到新的索引映射", () => {
    const graph = blank();
    for (const name of ["a", "b", "c"]) graph.addNode(vertex(name));
    const wasA = graph.indexOf(a);
    const wasC = graph.indexOf(c);
    graph.dropNode(a);

    let mapping: Int32Array | undefined;
    graph.signal.on("compacted", ({ nodes }) => {
      mapping = nodes;
    });
    graph.compact();

    expect(mapping![wasA]).toBe(-1);
    expect(mapping![wasC]).toBe(graph.indexOf(c));
  });

  it("clear 走删除原语，订阅者不会与图失同步", () => {
    const graph = blank();
    for (const name of ["a", "b"]) graph.addNode(vertex(name));
    graph.connect([a, "out"], [b, "in"]);
    const seen = record(graph);
    graph.clear();

    expect(graph.order).toBe(0);
    expect(graph.size).toBe(0);
    expect(seen).toEqual([
      "edgeDropped",
      "nodeDropped",
      "nodeDropped",
      "flushed",
    ]);
  });
});

describe("事务", () => {
  it("事件推迟到最外层结束，抛错也派发已积累的部分", () => {
    const graph = blank();
    const seen = record(graph);

    graph.batch(() => {
      graph.addNode(vertex("a"));
      graph.addNode(vertex("b"));
      expect(seen).toEqual([]);
    });
    expect(seen).toEqual(["nodeAdded", "nodeAdded", "flushed"]);

    seen.length = 0;
    expect(() =>
      graph.batch(() => {
        graph.addNode(vertex("c"));
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(seen).toEqual(["nodeAdded", "flushed"]);
  });

  it("flushed 收在末尾并报出这段事务的变更条数", () => {
    const graph = blank();
    const counts: number[] = [];
    graph.signal.on("flushed", ({ changes }) => counts.push(changes));

    graph.addNode(vertex("a"));
    expect(counts).toEqual([1]);

    graph.batch(() => {
      graph.addNode(vertex("b"));
      graph.connect([a, "out"], [b, "in"]);
      graph.setWeight(b, "x");
      expect(counts).toEqual([1]);
    });
    expect(counts).toEqual([1, 3]);
  });

  it("handler 里继续改图，新事件接在同一段事务后面", () => {
    const graph = blank();
    graph.addNode(vertex("a"));
    graph.addNode(vertex("b"));

    let grown = false;
    const seen = record(graph);
    graph.signal.on("*", (type) => {
      // 内层变更必须排在本段事务剩余事件之后，而不是抢先把 flushed 放掉。
      if (type === "nodeUpdated" && !grown) {
        grown = true;
        graph.addNode(vertex("c"));
      }
    });

    graph.batch(() => {
      graph.setWeight(a, "x");
      graph.setWeight(b, "y");
    });

    expect(seen).toEqual([
      "nodeUpdated",
      "nodeUpdated",
      "nodeAdded",
      "flushed",
    ]);
    expect(graph.hasNode(c)).toBe(true);
  });
});

describe("订阅者相互隔离", () => {
  it("抛错的订阅者不牵连其他订阅者，也不吞掉同批其他事件", () => {
    const graph = blank();
    const seen: string[] = [];

    let hits = 0;
    graph.signal.on("nodeAdded", () => {
      hits++;
      if (hits === 2) throw new Error("subscriber blew up");
    });
    graph.signal.on("nodeAdded", ({ node }) => seen.push(node));

    const names = ["a", "b", "c", "d"];
    expect(() => {
      graph.batch(() => {
        for (const name of names) graph.addNode(vertex(name));
      });
    }).toThrow("subscriber blew up");

    // 没有隔离时只收到 "a"：b/c/d 已从队列里摘走，补不回来，按索引维护增量状态的
    // 订阅者（Ordering、布局缓存）从此静默错位。
    expect(seen).toEqual(names);
  });

  it("抛错不留残状态，后续事务照常派发", () => {
    const graph = blank();
    const seen: string[] = [];
    graph.signal.on("nodeAdded", ({ node }) => {
      if (node === nodeId("bad")) throw new Error("once");
      seen.push(node);
    });

    expect(() => graph.addNode(vertex("bad"))).toThrow("once");
    graph.addNode(vertex("good"));
    expect(seen).toEqual([nodeId("good")]);
  });

  it("多个订阅者抛错时聚合成 AggregateError，一个不丢", () => {
    const graph = blank();
    graph.signal.on("nodeAdded", () => {
      throw new Error("first");
    });
    graph.signal.on("nodeAdded", () => {
      throw new Error("second");
    });

    let caught: unknown;
    try {
      graph.addNode(vertex("a"));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    const { errors } = caught as AggregateError;
    expect(errors.map((error) => (error as Error).message)).toEqual([
      "first",
      "second",
    ]);
  });
});

describe("版本号", () => {
  it("revision 随每次变更推进，无订阅者时也推进", () => {
    const graph = blank();
    const start = graph.revision;
    graph.addNode(vertex("a"));
    graph.addNode(vertex("b"));
    expect(graph.revision).toBeGreaterThan(start);

    const afterAdd = graph.revision;
    graph.connect([a, "out"], [b, "in"]);
    expect(graph.revision).toBeGreaterThan(afterAdd);
  });

  it("shape 只跟结构走，改权重不动它", () => {
    const graph = blank();
    graph.addNode(vertex("a"));
    graph.addNode(vertex("b"));
    const edge = graph.connect([a, "out"], [b, "in"]);

    const shape = graph.shape;
    graph.setWeight(a, "x");
    graph.setEdgeWeight(edge, 9);
    expect(graph.shape).toBe(shape);
    expect(graph.revision).toBeGreaterThan(shape);

    graph.disconnect(edge);
    expect(graph.shape).toBeGreaterThan(shape);
  });
});

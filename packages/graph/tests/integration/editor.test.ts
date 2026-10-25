import { describe, expect, it } from "vitest";

import {
  apply,
  criticalPath,
  diff,
  Graph,
  graphId,
  invert,
  nodeId,
  Ordering,
  pack,
  Port,
  settle,
  Snapshot,
  Socket,
  toposort,
  unpack,
  Vertex,
  type NodeId,
  type Sockets,
} from "../../index";
import { cost } from "../support";

/**
 * 编辑器全链路：编辑层的一次改动要同时穿过增量拓扑序（订阅事件）、快照编译（含复用）、
 * 算法层、序列化与撤销栈，五处对同一份图的理解必须始终一致。
 *
 * 单元测试各自只盯一层；这里盯的是层与层之间的接缝——事件漏一条、复用判定错一档、
 * 补丁少一个操作，单看哪一层都正常，合起来才对不上。
 */

const step = (
  name: string,
  seconds: number,
): Vertex<Sockets, Sockets, number> =>
  new Vertex<Sockets, Sockets, number>(nodeId(name), seconds)
    .addInput("in", Socket.number)
    .addOutput("out", Socket.number);

/** 一条带分组的小流水线：ingest → (parse | clean) → merge → report。 */
function pipeline(): Graph<number, number> {
  const graph = new Graph<number, number>(graphId("pipeline"));
  graph.batch(() => {
    for (const [name, seconds] of [
      ["ingest", 2],
      ["parse", 5],
      ["clean", 3],
      ["merge", 1],
      ["report", 4],
      ["prep", 0],
    ] as const) {
      graph.addNode(step(name, seconds));
    }
    graph.connect([nodeId("ingest"), "out"], [nodeId("parse"), "in"], {
      weight: 2,
    });
    graph.connect([nodeId("ingest"), "out"], [nodeId("clean"), "in"], {
      weight: 2,
    });
    graph.connect([nodeId("parse"), "out"], [nodeId("merge"), "in"], {
      weight: 5,
    });
    graph.connect([nodeId("clean"), "out"], [nodeId("merge"), "in"], {
      weight: 3,
    });
    graph.connect([nodeId("merge"), "out"], [nodeId("report"), "in"], {
      weight: 1,
    });
    graph.setParent(nodeId("parse"), nodeId("prep"));
    graph.setParent(nodeId("clean"), nodeId("prep"));
  });
  return graph;
}

/** 快照口径的拓扑序，换回 id 便于与增量顺序比对。 */
const compiled = (graph: Graph<number, number>): NodeId[] => {
  const snapshot = Snapshot.of(graph);
  return snapshot.names(settle(toposort(snapshot)));
};

/** 与写出顺序无关的内容指纹。 */
const fingerprint = (graph: Graph<number, number>): string => {
  const { compact } = pack(graph);
  const byId = (a: readonly unknown[], b: readonly unknown[]): number =>
    String(a[0]).localeCompare(String(b[0]));
  return JSON.stringify({
    n: [...compact.n].sort(byId),
    e: [...compact.e].sort(byId),
    h: [...(compact.h ?? [])].map(String).sort(),
  });
};

describe("编辑 → 增量顺序 → 编译 → 算法", () => {
  it("事务里的批量编辑之后，增量顺序与全量拓扑序等效", () => {
    const graph = pipeline();
    const ordering = new Ordering(graph);

    graph.batch(() => {
      graph.addNode(step("verify", 2));
      graph.connect([nodeId("report"), "out"], [nodeId("verify"), "in"], {
        weight: 4,
      });
      graph.dropNode(nodeId("clean"));
    });

    // 两条独立的路径：一条靠事件增量维护，一条靠重新编译后跑 Kahn。
    const incremental = new Map(ordering.sorted().map((id, at) => [id, at]));
    for (const edge of graph.edges()) {
      const record = graph.edge(edge)!;
      expect(incremental.get(record.source)!).toBeLessThan(
        incremental.get(record.target)!,
      );
    }
    expect(ordering.sorted()).toHaveLength(graph.order);
    expect(compiled(graph)).toHaveLength(graph.order);
    ordering.dispose();
  });

  it("只改权重时走增量复用，算法结果与全量编译逐位一致", () => {
    const graph = pipeline();
    const base = Snapshot.of(graph, { weight: cost });
    const before = settle(criticalPath(base));

    graph.setEdgeWeight(graph.edges()[0]!, 40);
    const reused = Snapshot.of(graph, { weight: cost, reuse: base });
    const full = Snapshot.of(graph, { weight: cost });

    expect(reused.outbound).toBe(base.outbound); // 确实走了复用
    expect([...reused.weight!]).toEqual([...full.weight!]);

    const after = settle(criticalPath(reused));
    expect(after.length).toBeCloseTo(settle(criticalPath(full)).length, 9);
    expect(after.length).toBeGreaterThan(before.length);
  });

  it("折叠分组后算法看到的是聚合后的图", () => {
    const graph = pipeline();
    const folded = Snapshot.of(graph, { collapse: [nodeId("prep")] });

    expect(folded.nodes).not.toContain(nodeId("parse"));
    expect(folded.nodes).toContain(nodeId("prep"));
    expect(settle(toposort(folded))).toHaveLength(folded.order);
  });
});

describe("序列化与撤销栈", () => {
  it("pack / unpack 往返后，各层看到的图完全一致", () => {
    const graph = pipeline();
    const restored = unpack<number, number>(pack(graph));

    expect(fingerprint(restored)).toBe(fingerprint(graph));
    expect(compiled(restored)).toEqual(compiled(graph));
    expect(restored.parent(nodeId("parse"))).toBe(nodeId("prep"));

    const one = Snapshot.of(graph, { weight: cost });
    const two = Snapshot.of(restored, { weight: cost });
    expect(settle(criticalPath(two)).length).toBeCloseTo(
      settle(criticalPath(one)).length,
      9,
    );
  });

  it("一整段编辑可以整体撤销，层级与端口都回到原样", () => {
    const before = pipeline();
    const after = before.copy();

    after.batch(() => {
      after.reshape(nodeId("merge"), {
        outputs: { out: new Port(Socket.string) },
      });
      after.dropNode(nodeId("report"));
      after.addNode(step("archive", 7));
      after.setParent(nodeId("archive"), nodeId("prep"));
      after.setWeight(nodeId("ingest"), 99);
    });

    const changes = diff(before, after);
    const target = before.copy();

    apply(target, changes);
    expect(fingerprint(target)).toBe(fingerprint(after));

    apply(target, invert(changes));
    expect(fingerprint(target)).toBe(fingerprint(before));
    expect(target.parent(nodeId("parse"))).toBe(nodeId("prep"));
    expect(compiled(target)).toEqual(compiled(before));
  });

  it("撤销之后重新订阅的增量顺序仍然有效", () => {
    const before = pipeline();
    const after = before.copy();
    after.dropNode(nodeId("merge"));

    const target = before.copy();
    const changes = diff(before, after);
    apply(target, changes);
    apply(target, invert(changes));

    const ordering = new Ordering(target);
    expect(ordering.cyclic).toBe(false);
    expect(ordering.sorted()).toEqual(expect.arrayContaining(before.nodes()));
    ordering.dispose();
  });
});

import { describe, expect, it } from "vitest";

import { FlowGraph, GraphValueError, loop, tool, type Kind } from "../../index";
import { double, finish, number, route, script } from "../support";

describe("FlowGraph", () => {
  it("infers ports from the kinds", () => {
    const flow = new FlowGraph()
      .addNode("a", double, { input: { value: 1 } })
      .addNode("b", double)
      .addNode("f", finish)
      .addEdge("a", "b")
      .addEdge("b", "f");
    expect(flow.toJSON().edges).toEqual([
      { from: ["a", "result"], to: ["b", "value"] },
      { from: ["b", "result"], to: ["f", "value"] },
    ]);
  });

  it("takes explicit ports and edge probabilities", () => {
    const flow = new FlowGraph()
      .addNode("r", route)
      .addNode("x", double)
      .addEdge("r.yes", "x.value", { probability: 0.4 });
    expect(flow.toJSON().edges).toEqual([
      {
        from: ["r", "yes"],
        to: ["x", "value"],
        weight: { probability: 0.4 },
      },
    ]);
  });

  it("refuses ambiguous ports, unknown nodes and duplicates", () => {
    const flow = new FlowGraph().addNode("r", route).addNode("x", double);
    expect(() => flow.addEdge("r", "x")).toThrow(
      "name the output port of r: yes, no",
    );
    expect(() => flow.addEdge("missing", "x")).toThrow("unknown node missing");
    expect(() => flow.addNode("x", number)).toThrow(GraphValueError);
    const imposter: Kind = { ...number, name: "double" };
    expect(() => flow.addNode("y", imposter)).toThrow(
      "two different kinds are named double",
    );
  });

  it("registers the kinds a planner uses", () => {
    const search = tool(() => "ok", { name: "search", description: "Search." });
    const flow = new FlowGraph().addNode(
      "agent",
      loop({ tools: [search] }, script([]).model),
    );
    expect([...flow.kinds.keys()].sort()).toEqual(["loop", "search"]);
  });

  it("compiles a snapshot of the template", () => {
    const flow = new FlowGraph().addNode("a", double);
    const graph = flow.compile();
    flow.addNode("b", double);
    expect(graph.getGraph().nodes.map((node) => node.id)).toEqual(["a"]);
  });

  it("rebuilds itself from its outline", () => {
    const flow = new FlowGraph()
      .addNode("a", double, { input: { value: 2 } })
      .addNode("f", finish)
      .addEdge("a", "f");
    expect(FlowGraph.from(flow.toJSON(), flow.kinds.values()).toJSON()).toEqual(
      flow.toJSON(),
    );
  });
});

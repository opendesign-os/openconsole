import { describe, expect, it } from "vitest";

import { DefinitionError, tool, Workflow, type Operator } from "../../index";
import { double, finish, number, route } from "../support";

const flow = () => new Workflow({ name: "flow" });

describe("Workflow", () => {
  it("infers ports from the operators", () => {
    const workflow = flow()
      .node("a", double, { input: { value: 1 } })
      .node("b", double)
      .node("f", finish)
      .edge("a", "b")
      .edge("b", "f");
    expect(workflow.toJSON().edges).toEqual([
      { from: ["a", "result"], to: ["b", "value"] },
      { from: ["b", "result"], to: ["f", "value"] },
    ]);
  });

  it("takes explicit ports and edge probabilities", () => {
    const workflow = flow()
      .node("r", route)
      .node("x", double)
      .edge("r.yes", "x.value", { probability: 0.4 });
    expect(workflow.toJSON().edges).toEqual([
      {
        from: ["r", "yes"],
        to: ["x", "value"],
        weight: { probability: 0.4 },
      },
    ]);
  });

  it("refuses ambiguous ports, unknown nodes and duplicates", () => {
    const workflow = flow().node("r", route).node("x", double);
    expect(() => workflow.edge("r", "x")).toThrow(
      "name the output port of r: yes, no",
    );
    expect(() => workflow.edge("missing", "x")).toThrow("unknown node missing");
    expect(() => workflow.node("x", number)).toThrow(DefinitionError);
    const imposter: Operator = { ...number, name: "double" };
    expect(() => workflow.node("y", imposter)).toThrow(
      "two different operators are named double",
    );
  });

  it("registers the operators a planner uses", () => {
    const search = tool(() => "ok", { name: "search", description: "Search." });
    const planner: Operator = {
      name: "planner",
      description: "Plans with search.",
      plans: true,
      uses: [search],
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: {} },
      run: async () => ({}),
    };
    const workflow = flow().node("agent", planner);
    expect([...workflow.operators.keys()].sort()).toEqual([
      "planner",
      "search",
    ]);
  });

  it("rebuilds itself from its outline", () => {
    const workflow = flow()
      .node("a", double, { input: { value: 2 } })
      .node("f", finish)
      .edge("a", "f");
    const copy = Workflow.from(workflow.toJSON(), workflow.operators.values(), {
      name: "copy",
    });
    expect(copy.toJSON()).toEqual(workflow.toJSON());
    expect(workflow.copy().toJSON()).toEqual(workflow.toJSON());
  });
});

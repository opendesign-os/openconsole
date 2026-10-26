import { describe, expect, it } from "vitest";

import { assemble, DefinitionError, outline, registry } from "../../index";
import { double, finish } from "../support";

describe("template", () => {
  it("round-trips a template through an outline", () => {
    const operators = registry(double, finish);
    const source = {
      nodes: [
        { id: "p", operator: "finish" },
        { id: "c", operator: "double", values: { value: 2 }, parent: "p" },
      ],
      edges: [
        {
          from: ["c", "result"] as const,
          to: ["p", "value"] as const,
          weight: { probability: 0.3 },
        },
      ],
    };
    expect(outline(assemble(source, operators))).toEqual(source);
  });

  it("refuses unknown operators", () => {
    expect(() =>
      assemble(
        { nodes: [{ id: "x", operator: "missing" }], edges: [] },
        registry(),
      ),
    ).toThrow(DefinitionError);
  });
});

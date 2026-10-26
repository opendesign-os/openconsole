import { describe, expect, it } from "vitest";

import { assemble, GraphValueError, outline, registry } from "../../index";
import { double, finish } from "../support";

describe("template", () => {
  it("round-trips a template through an outline", () => {
    const kinds = registry(double, finish);
    const source = {
      nodes: [
        { id: "p", kind: "finish" },
        { id: "c", kind: "double", values: { value: 2 }, parent: "p" },
      ],
      edges: [
        {
          from: ["c", "result"] as const,
          to: ["p", "value"] as const,
          weight: { probability: 0.3 },
        },
      ],
    };
    expect(outline(assemble(source, kinds))).toEqual(source);
  });

  it("refuses unknown kinds", () => {
    expect(() =>
      assemble(
        { nodes: [{ id: "x", kind: "missing" }], edges: [] },
        registry(),
      ),
    ).toThrow(GraphValueError);
  });
});

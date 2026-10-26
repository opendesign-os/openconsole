import { describe, expect, it } from "vitest";

import { candidates, FlowGraph, sample, tune } from "../../index";
import { double, finish, number } from "../support";

function seeded(start: number): () => number {
  let state = start;
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

describe("edge optimization", () => {
  it("never samples an edge that would close a cycle", () => {
    const flow = new FlowGraph()
      .addNode("a", double)
      .addNode("b", double)
      .addEdge("a", "b")
      .addEdge("b", "a", { probability: 1 });
    const [edge] = candidates(flow);
    if (edge === undefined) throw new Error("missing candidate");
    const draw = sample(flow, () => 0);
    expect(draw.picks.get(edge)).toBe(false);
    expect(draw.flow.template.hasEdge(edge)).toBe(false);
    expect(flow.template.hasEdge(edge)).toBe(true);
  });

  it("raises the probability of edges that help", async () => {
    const flow = new FlowGraph()
      .addNode("one", number, { input: { value: 1 } })
      .addNode("out", finish)
      .addEdge("one", "out", { probability: 0.5 });
    const history = await tune(
      flow,
      {
        cases: [{ input: {}, expect: 1 }],
        score: (answer, item) => (answer === item.expect ? 1 : 0),
      },
      { rounds: 6, batch: 6, random: seeded(7) },
    );
    const [edge] = candidates(flow);
    if (edge === undefined) throw new Error("missing candidate");
    const weight = flow.template.edgeWeight(edge) as { probability: number };
    expect(history).toHaveLength(6);
    expect(weight.probability).toBeGreaterThan(0.6);
  });
});

import { describe, expect, it } from "vitest";

import { evaluate, FlowGraph, summarize } from "../../index";
import { finish } from "../support";

describe("evaluate", () => {
  it("scores every case on every repeat", async () => {
    const report = await evaluate(new FlowGraph().addNode("f", finish), {
      cases: [
        { input: { value: 1 }, expect: 1 },
        { input: { value: 2 }, expect: 3 },
      ],
      score: (answer, sample) => (answer === sample.expect ? 1 : 0),
      repeats: 2,
    });
    expect(report.trials).toHaveLength(4);
    expect(report.mean).toBe(0.5);
    expect(report.deviation).toBe(0.5);
  });

  it("reports zero for an empty run", () => {
    expect(summarize([])).toEqual({
      mean: 0,
      deviation: 0,
      tokens: 0,
      trials: [],
    });
  });
});

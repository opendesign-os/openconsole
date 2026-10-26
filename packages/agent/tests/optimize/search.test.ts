import { describe, expect, it } from "vitest";

import {
  FlowGraph,
  proposer,
  search,
  summarize,
  type Bench,
  type Proposer,
} from "../../index";
import { finish, id, messages, say, script, sse } from "../support";

const template = () =>
  new FlowGraph().addNode("out", finish, { input: { value: 0 } });

const bench: Bench = {
  cases: [{ input: {}, expect: 1 }],
  score: (answer, sample) => (answer === sample.expect ? 1 : 0),
};

describe("structure search", () => {
  it("keeps the variant whose change improved the score", async () => {
    const propose: Proposer = async (variant) => {
      const child = variant.flow.copy();
      child.template.setWeight(id("out"), {
        kind: "finish",
        values: { value: 1 },
      });
      return child;
    };
    const variants = await search(template(), bench, propose, {
      rounds: 5,
      patience: 2,
      random: () => 0,
    });
    const [best] = variants;
    expect(best?.report.mean).toBe(1);
    expect(best?.changes.map((change) => change.kind)).toEqual(["weighNode"]);
    const root = variants.find((variant) => variant.id === 0);
    expect(root?.lessons).toEqual([
      expect.objectContaining({ before: 0, after: 1 }),
    ]);
    expect(variants).toHaveLength(2);
  });

  it("builds a proposal from the model's outline", async () => {
    const { model, requests } = script([
      sse(
        say(
          '{"nodes": [{"id": "out", "kind": "finish", "values": {"value": 1}}], "edges": []}',
        ),
      ),
    ]);
    const flow = await proposer(model)({
      id: 0,
      flow: template(),
      parent: undefined,
      changes: [],
      report: summarize([]),
      lessons: [],
    });
    expect(flow.template.nodeWeight(id("out"))?.values).toEqual({ value: 1 });
    expect(String(messages(requests[0] ?? {})[1]?.["content"])).toContain(
      '"kinds"',
    );
  });
});

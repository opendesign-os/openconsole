import { describe, expect, it } from "vitest";

import { explore, type Prompt } from "../../index";
import { messages, say, script, sse, type Body } from "../support";

const echo: Prompt = {
  name: "echo",
  description: "Answers a question.",
  systemPrompt: "Answer.",
  inputSchema: {
    type: "object",
    properties: { question: { type: "string" } },
    required: ["question"],
  },
  outputSchema: {
    type: "object",
    properties: { answer: { type: "string" } },
    required: ["answer"],
  },
};

describe("archive", () => {
  it("adds a better design found by the meta agent", async () => {
    const solver: Prompt = {
      ...echo,
      name: "solver",
      systemPrompt: "Solve exactly.",
    };
    const meta = script([
      sse(say(JSON.stringify(solver))),
      sse(say(JSON.stringify(solver))),
    ]);
    const worker = script(
      [0, 1].map(
        () => (body: Body) =>
          sse(
            say(
              String(messages(body)[0]?.["content"]).startsWith(
                "Solve exactly.",
              )
                ? '{"answer": "right"}'
                : '{"answer": "wrong"}',
            ),
          ),
      ),
    );
    const archive = await explore(
      [echo],
      {
        cases: [{ input: { question: "q" }, expect: "right" }],
        score: (answer, sample) => (answer === sample.expect ? 1 : 0),
      },
      { meta: meta.model, worker: worker.model, rounds: 1, reflections: 1 },
    );
    expect(
      archive.map((entry) => [
        entry.spec.name,
        entry.report.mean,
        entry.generation,
      ]),
    ).toEqual([
      ["solver", 1, 1],
      ["echo", 0, 0],
    ]);
  });
});

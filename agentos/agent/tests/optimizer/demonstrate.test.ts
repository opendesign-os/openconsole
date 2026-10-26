import { Workflow } from "@openagent/core";
import { describe, expect, it } from "vitest";

import {
  demonstrate,
  evaluate,
  prompt,
  refine,
  type Prompt,
  type Report,
} from "../../index";
import { messages, say, script, sse, type Body } from "../../testing";

const solve: Prompt = {
  name: "solve",
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

async function history(): Promise<Report> {
  const worker = script(
    [0, 1].map(
      () => (body: Body) =>
        sse(
          say(
            String(messages(body).at(-1)?.["content"]).includes('"a"')
              ? '{"answer": "A"}'
              : '{"answer": "?"}',
          ),
        ),
    ),
  );
  return evaluate(
    new Workflow({ name: "flow" }).node("solve", prompt(solve, worker.model)),
    {
      cases: [
        { input: { question: "a" }, expect: "A" },
        { input: { question: "b" }, expect: "B" },
      ],
      score: (answer, sample) => (answer === sample.expect ? 1 : 0),
    },
  );
}

describe("node optimization", () => {
  it("picks demonstrations from runs that scored well", async () => {
    const improved = demonstrate(solve, await history());
    expect(improved.examples).toEqual([
      { input: { question: "a" }, output: { answer: "A" } },
    ]);
  });

  it("rewrites the system prompt from the history", async () => {
    const meta = script([
      sse(say('{"systemPrompt": "Answer with one capital letter."}')),
    ]);
    const improved = await refine(solve, await history(), meta.model);
    expect(improved.systemPrompt).toBe("Answer with one capital letter.");
    expect(String(messages(meta.requests[0] ?? {})[1]?.["content"])).toContain(
      '"score":0',
    );
  });
});

import { Workflow } from "@openagent/core";
import { describe, expect, it } from "vitest";

import { prompt, type Prompt } from "../../index";
import { messages, say, script, sse } from "../../testing";

const spec: Prompt = {
  name: "solve",
  description: "Solves a question.",
  systemPrompt: "Answer the question.",
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

const solve = (operator: ReturnType<typeof prompt>) =>
  new Workflow({ name: "flow" }).node("solve", operator);

describe("prompt", () => {
  it("returns structured output and retries an invalid reply", async () => {
    const { model, requests } = script([
      sse(say("I think it is 42")),
      sse(say('```json\n{"answer": "42"}\n```')),
    ]);
    const { output } = await solve(prompt(spec, model)).run({
      question: "6 x 7?",
    });
    expect(output).toEqual({ answer: "42" });
    expect(requests[0]).toMatchObject({
      response_format: { type: "json_schema", json_schema: { name: "solve" } },
    });
    expect(String(messages(requests[1] ?? {}).at(-1)?.["content"])).toContain(
      "That reply was invalid",
    );
  });

  it("shows examples as earlier turns", async () => {
    const { model, requests } = script([sse(say('{"answer": "4"}'))]);
    const operator = prompt(
      {
        ...spec,
        examples: [{ input: { question: "1+1" }, output: { answer: "2" } }],
      },
      model,
    );
    await solve(operator).run({ question: "2+2" });
    expect(
      messages(requests[0] ?? {}).map((message) => message["content"]),
    ).toEqual([
      "Answer the question.\n\nReply with a single JSON object.",
      '{"question":"1+1"}',
      '{"answer":"2"}',
      '{"question":"2+2"}',
    ]);
  });

  it("puts the schema in the prompt when structured outputs are missing", async () => {
    const { model, requests } = script([sse(say('{"answer": "yes"}'))], {
      structured: "none",
    });
    await solve(prompt(spec, model)).run({ question: "?" });
    expect(requests[0]).not.toHaveProperty("response_format");
    expect(String(messages(requests[0] ?? {})[0]?.["content"])).toContain(
      '"required":["answer"]',
    );
  });
});

import { describe, expect, it } from "vitest";

import { FlowGraph, prompt, type Prompt } from "../../index";
import { messages, say, script, sse } from "../support";

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

const solve = (kind: ReturnType<typeof prompt>) =>
  new FlowGraph().addNode("solve", kind).compile();

describe("prompt", () => {
  it("returns structured output and retries an invalid reply", async () => {
    const { model, requests } = script([
      sse(say("I think it is 42")),
      sse(say('```json\n{"answer": "42"}\n```')),
    ]);
    const values = await solve(prompt(spec, model)).invoke({
      question: "6 x 7?",
    });
    expect(values).toEqual({ answer: "42" });
    expect(requests[0]).toMatchObject({
      response_format: { type: "json_schema", json_schema: { name: "solve" } },
    });
    expect(String(messages(requests[1] ?? {}).at(-1)?.["content"])).toContain(
      "That reply was invalid",
    );
  });

  it("shows examples as earlier turns", async () => {
    const { model, requests } = script([sse(say('{"answer": "4"}'))]);
    const kind = prompt(
      {
        ...spec,
        examples: [{ input: { question: "1+1" }, output: { answer: "2" } }],
      },
      model,
    );
    await solve(kind).invoke({ question: "2+2" });
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
    await solve(prompt(spec, model)).invoke({ question: "?" });
    expect(requests[0]).not.toHaveProperty("response_format");
    expect(String(messages(requests[0] ?? {})[0]?.["content"])).toContain(
      '"required":["answer"]',
    );
  });
});

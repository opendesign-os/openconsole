import { describe, expect, it } from "vitest";

import {
  createAgent,
  createCompilerAgent,
  MemorySaver,
  tool,
} from "../../index";
import { invoke, lines, messages, say, script, sse } from "../support";

const weather = tool(() => "sunny", {
  name: "weather",
  description: "Weather of a city.",
  schema: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  },
});

describe("createAgent", () => {
  it("answers through tool calls", async () => {
    const { model } = script([
      sse(invoke([{ name: "weather", args: { city: "Beijing" } }])),
      sse(say("Go running.")),
    ]);
    const agent = createAgent({
      model,
      tools: [weather],
      systemPrompt: "You plan outdoor activities.",
    });
    const result = await agent.invoke({
      messages: [{ role: "user", content: "Can I run today?" }],
    });
    expect(result["answer"]).toBe("Go running.");
    const transcript = result["messages"] as { role: string }[];
    expect(transcript.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
  });

  it("remembers the conversation on a thread", async () => {
    const { model, requests } = script([
      sse(say("Hello, Ann.")),
      sse(say("Your name is Ann.")),
    ]);
    const agent = createAgent({
      model,
      tools: [],
      checkpointer: new MemorySaver(),
    });
    const config = { configurable: { thread_id: "chat" } };
    await agent.invoke(
      { messages: [{ role: "user", content: "I am Ann." }] },
      config,
    );
    await agent.invoke(
      { messages: [{ role: "user", content: "Who am I?" }] },
      config,
    );
    expect(
      messages(requests[1] ?? {}).map((message) => message["content"]),
    ).toEqual(["I am Ann.", "Hello, Ann.", "Who am I?"]);
  });

  it("becomes a tool for another agent", async () => {
    const inner = script([sse(say("x is 1"))]);
    const research = createAgent({ model: inner.model, tools: [] }).asTool({
      name: "research",
      description: "Researches a question in a separate context.",
    });
    const outer = script([
      sse(invoke([{ name: "research", args: { task: "what is x" } }])),
      sse(say("x is 1, confirmed")),
    ]);
    const lead = createAgent({ model: outer.model, tools: [research] });
    const result = await lead.invoke({ task: "find x" });
    expect(result["answer"]).toBe("x is 1, confirmed");
    expect(messages(inner.requests[0] ?? {})).toEqual([
      { role: "user", content: "what is x" },
    ]);
    expect(messages(outer.requests[1] ?? {}).at(-1)).toEqual({
      role: "tool",
      tool_call_id: "call_0",
      content: "x is 1",
    });
  });
});

describe("createCompilerAgent", () => {
  it("plans the calls up front and joins the results", async () => {
    const { model } = script([
      sse(lines('{"id": 1, "kind": "weather", "args": {"city": "Paris"}}')),
      sse(say('{"answer": "Paris is sunny."}')),
    ]);
    const agent = createCompilerAgent({ model, tools: [weather] });
    expect(await agent.invoke({ task: "Weather in Paris?" })).toEqual({
      answer: "Paris is sunny.",
    });
  });
});

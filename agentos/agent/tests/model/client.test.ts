import { describe, expect, it } from "vitest";

import { APIError, complete, type Message } from "../../index";
import { invoke, say, script, sse } from "../../testing";

describe("complete", () => {
  it("streams content and collects usage", async () => {
    const { model, requests, urls } = script([
      sse([
        { choices: [{ delta: { reasoning_content: "thinking" } }] },
        ...say("hello world"),
      ]),
    ]);
    const deltas: string[] = [];
    const reply = await complete(
      model,
      { messages: [{ role: "user", content: "hi" }] },
      { delta: (text) => deltas.push(text) },
    );
    expect(reply.content).toBe("hello world");
    expect(reply.reasoning).toBe("thinking");
    expect(reply.finish).toBe("stop");
    expect(reply.usage).toEqual({ input: 10, output: 5 });
    expect(deltas.join("")).toBe("hello world");
    expect(urls[0]).toBe("https://model.test/v1/chat/completions");
    expect(requests[0]).toMatchObject({
      model: "test",
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it("joins tool call fragments by index", async () => {
    const { model } = script([
      sse(
        invoke([
          { name: "search", args: { query: "graph" } },
          { name: "fetch", args: { url: "https://example.com" } },
        ]),
      ),
    ]);
    const reply = await complete(model, {
      messages: [{ role: "user", content: "go" }],
    });
    expect(reply.finish).toBe("tool_calls");
    expect(reply.calls.map((call) => call.id)).toEqual(["call_0", "call_1"]);
    expect(
      reply.calls.map((call) => JSON.parse(call.function.arguments)),
    ).toEqual([{ query: "graph" }, { url: "https://example.com" }]);
  });

  it("shapes the request by profile and model defaults", async () => {
    const history: Message[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "ok", reasoning_content: "secret" },
      { role: "user", content: "again" },
    ];
    const responseFormat = { name: "answer", schema: { type: "object" } };
    const standard = script([sse(say("{}"))]);
    await complete(
      { ...standard.model, temperature: 0.2, maxTokens: 32 },
      { messages: history, responseFormat, maxTokens: 64 },
    );
    expect(standard.requests[0]).toMatchObject({
      max_tokens: 64,
      temperature: 0.2,
      response_format: { type: "json_schema", json_schema: { name: "answer" } },
    });
    expect(JSON.stringify(standard.requests[0])).not.toContain("secret");

    const custom = script([sse(say("{}"))], {
      structured: "json",
      limit: "max_completion_tokens",
      usage: false,
      reasoning: "send",
    });
    await complete(custom.model, {
      messages: history,
      responseFormat,
      maxTokens: 64,
    });
    expect(custom.requests[0]).toMatchObject({
      max_completion_tokens: 64,
      response_format: { type: "json_object" },
    });
    expect(custom.requests[0]).not.toHaveProperty("stream_options");
    expect(JSON.stringify(custom.requests[0])).toContain("secret");
  });

  it("retries retryable statuses", async () => {
    const { model, requests } = script([
      new Response("slow down", {
        status: 429,
        headers: { "retry-after": "0.01" },
      }),
      sse(say("done")),
    ]);
    const reply = await complete(
      { ...model, retries: 1 },
      { messages: [{ role: "user", content: "hi" }] },
    );
    expect(reply.content).toBe("done");
    expect(requests).toHaveLength(2);
  });

  it("fails fast on other statuses", async () => {
    const { model } = script([new Response("bad", { status: 400 })]);
    await expect(
      complete(
        { ...model, retries: 3 },
        { messages: [{ role: "user", content: "hi" }] },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refuses tools when the profile has none", async () => {
    const { model } = script([], { tools: false });
    await expect(
      complete(model, {
        messages: [{ role: "user", content: "hi" }],
        tools: [{ name: "search", description: "", parameters: {} }],
      }),
    ).rejects.toBeInstanceOf(APIError);
  });

  it("accepts a non-streaming JSON reply", async () => {
    const { model } = script([
      Response.json({
        choices: [
          {
            message: {
              content: "plain",
              tool_calls: [
                {
                  id: "a",
                  type: "function",
                  function: { name: "f", arguments: "{}" },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      }),
    ]);
    const reply = await complete(model, {
      messages: [{ role: "user", content: "hi" }],
    });
    expect(reply.content).toBe("plain");
    expect(reply.calls[0]?.id).toBe("a");
    expect(reply.usage).toEqual({ input: 3, output: 4 });
  });
});

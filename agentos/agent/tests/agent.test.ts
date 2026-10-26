import { tool } from "@openagent/core";
import { describe, expect, it } from "vitest";

import { definePlugin } from "@openconsole/plugable";

import {
  Agent,
  compiler,
  compress,
  history,
  MemoryBackend,
  workspace,
  type AgentHooks,
  type AgentHost,
} from "../index";
import {
  invoke,
  lines,
  messages,
  say,
  script,
  sse,
  type Body,
} from "../testing";

const weather = tool(() => "sunny", {
  name: "weather",
  description: "Weather of a city.",
  schema: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  },
});

const empty = JSON.stringify({ entities: [], facts: [], expired: [] });

const tools = (body: Body) =>
  messages(body)
    .filter((message) => message["role"] === "tool")
    .map((message) => message["content"]);

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of source) items.push(item);
  return items;
}

describe("Agent", () => {
  it("answers a string and streams its tokens", async () => {
    const { model, requests } = script([
      sse(say("Hello.")),
      sse(say("Hi there.")),
    ]);
    const agent = new Agent({
      name: "agent",
      model,
      instructions: "Be brief.",
    });
    const run = await agent.run("Hi");
    expect(run).toMatchObject({
      status: "completed",
      output: { answer: "Hello." },
    });
    expect(messages(requests[0] ?? {})).toEqual([
      { role: "system", content: "Be brief." },
      { role: "user", content: "Hi" },
    ]);
    const events = await collect(agent.stream("Hi again"));
    expect(
      events
        .flatMap((event) => (event.type === "delta" ? [event.text] : []))
        .join(""),
    ).toBe("Hi there.");
    expect(events.at(-1)?.type).toBe("end");
  });

  it.each([
    [{ type: "approve" }, "/a.md", "Wrote /a.md"],
    [
      { type: "edit", input: { path: "/b.md", content: "edited" } },
      "/b.md",
      "Wrote /b.md",
    ],
    [
      { type: "reject", reason: "not now" },
      undefined,
      "The call to write was rejected: not now",
    ],
  ])(
    "asks before the workspace writes (%j)",
    async (decision, written, outcome) => {
      const backend = new MemoryBackend();
      const { model, requests } = script([
        sse(
          invoke([
            { name: "write", args: { path: "/a.md", content: "draft" } },
          ]),
        ),
        sse(say("Done.")),
      ]);
      const agent = new Agent({
        name: "agent",
        model,
        tools: [workspace(backend)],
      });
      const paused = await agent.run("Save a note.", { session: "s" });
      expect(paused).toMatchObject({
        status: "paused",
        pending: [
          {
            id: "agent/1",
            value: {
              tool: "write",
              input: { path: "/a.md", content: "draft" },
            },
          },
        ],
      });
      expect(String(messages(requests[0] ?? {})[0]?.["content"])).toContain(
        "You have a workspace",
      );
      const done = await agent.run(
        { resume: { "agent/1": decision } },
        { session: "s" },
      );
      expect(done.output["answer"]).toBe("Done.");
      expect(await backend.list()).toEqual(
        written === undefined ? [] : [written],
      );
      expect(tools(requests[1] ?? {})).toEqual([outcome]);
    },
  );

  it("uses other agents as tools", async () => {
    const inner = script([sse(say("x is 1"))]);
    const researcher = new Agent({
      name: "researcher",
      description: "Researches a question in a fresh context.",
      model: inner.model,
    });
    const outer = script([
      sse(invoke([{ name: "researcher", args: { task: "what is x" } }])),
      sse(say("x is 1, confirmed")),
    ]);
    const lead = new Agent({
      name: "lead",
      model: outer.model,
      tools: [researcher],
    });
    const run = await lead.run("find x");
    expect(run.output["answer"]).toBe("x is 1, confirmed");
    expect(messages(inner.requests[0] ?? {})).toEqual([
      { role: "user", content: "what is x" },
    ]);
    expect(tools(outer.requests[1] ?? {})).toEqual(["x is 1"]);
  });

  it("plans with the compiler", async () => {
    const { model } = script([
      sse(lines('{"id": 1, "tool": "weather", "args": {"city": "Paris"}}')),
      sse(say('{"answer": "Paris is sunny."}')),
    ]);
    const agent = new Agent({
      name: "agent",
      model,
      tools: [weather],
      planner: compiler(),
    });
    expect((await agent.run({ task: "Weather in Paris?" })).output).toEqual({
      answer: "Paris is sunny.",
    });
  });

  it("puts recent runs of the session in context", async () => {
    const { model, requests } = script([
      sse(say("Hello, Ann.")),
      sse(say("You are Ann.")),
    ]);
    const agent = new Agent({ name: "agent", model, plugins: [history(1)] });
    await agent.run("I am Ann.", { session: "s" });
    const second = await agent.run("Who am I?", { session: "s" });
    expect(
      messages(requests[1] ?? {}).map((message) => message["content"]),
    ).toEqual(["I am Ann.", "Hello, Ann.", "Who am I?"]);
    expect(second.output["messages"]).toHaveLength(2);
  });

  it("remembers earlier runs in its memory graph", async () => {
    const { model, requests } = script([
      sse(say("Nice.")),
      sse(
        say(
          JSON.stringify({
            entities: [{ name: "Ann", summary: "The user." }],
            facts: [
              {
                subject: "Ann",
                relation: "likes",
                object: "running",
                statement: "Ann likes running.",
              },
            ],
            expired: [],
          }),
        ),
      ),
      sse(say("Running.")),
      sse(say(empty)),
    ]);
    const agent = new Agent({ name: "agent", model, plugins: [compress()] });
    await agent.run("Ann likes running.", { session: "s" });
    const second = await agent.run("What does Ann like?", { session: "s" });
    expect(second.output["answer"]).toBe("Running.");
    expect(String(messages(requests[2] ?? {})[0]?.["content"])).toContain(
      "- Ann likes running.",
    );
    expect(await agent.store.get("memory", "s")).toBeDefined();
  });

  it("folds older messages into memory when the context is too big", async () => {
    const { model, requests } = script([
      sse(
        say(
          JSON.stringify({
            entities: [],
            facts: [
              {
                subject: "Ann",
                relation: "said",
                object: "first",
                statement: "Ann said first.",
              },
            ],
            expired: [],
          }),
        ),
      ),
      sse(say("Done.")),
      sse(say(empty)),
    ]);
    const agent = new Agent({
      name: "agent",
      model,
      plugins: [compress({ budget: 10 })],
    });
    const run = await agent.run({
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "one" },
        { role: "user", content: "second" },
        { role: "assistant", content: "two" },
        { role: "user", content: "third" },
      ],
    });
    const sent = messages(requests[1] ?? {});
    expect(String(sent[0]?.["content"])).toContain("- Ann said first.");
    expect(sent.slice(1).map((message) => message["content"])).toEqual([
      "second",
      "two",
      "third",
    ]);
    expect(run.output["messages"]).toHaveLength(4);
  });

  it("stores long tool results and reads them back with expand", async () => {
    const big = tool(() => "x".repeat(30_000), {
      name: "big",
      description: "Returns a lot.",
    });
    const { model, requests } = script([
      sse(invoke([{ name: "big", args: {} }])),
      (body) => {
        const stored = String(tools(body).at(-1));
        const id = /the id (\S+) to read/.exec(stored)?.[1] ?? "";
        return sse(invoke([{ name: "expand", args: { id, offset: 29_990 } }]));
      },
      sse(say("Read it.")),
      sse(say(empty)),
    ]);
    const agent = new Agent({
      name: "agent",
      model,
      tools: [big],
      plugins: [compress()],
    });
    await agent.run("Go.");
    expect(String(tools(requests[1] ?? {})[0])).toMatch(
      /^This result has 30000 characters/,
    );
    expect(tools(requests[2] ?? {}).at(-1)).toBe("x".repeat(10));
  });

  it("lets plugins decide tool permissions", async () => {
    const deny = definePlugin<AgentHooks, AgentHost>({
      name: "deny",
      setup(api) {
        api.hooks.permission.tap({}, ({ tool: operator }, output) => {
          if (operator.name !== "weather") return;
          output.status = "deny";
          output.reason = "not today";
        });
      },
    });
    const { model, requests } = script([
      sse(invoke([{ name: "weather", args: { city: "Paris" } }])),
      sse(say("Sorry.")),
    ]);
    const agent = new Agent({
      name: "agent",
      model,
      tools: [weather],
      plugins: [deny],
    });
    await agent.run("Weather?");
    expect(tools(requests[1] ?? {})).toEqual([
      "The call to weather was denied: not today",
    ]);
    await agent.dispose();
  });

  it("pauses for a sub-agent's approval and resumes it", async () => {
    const backend = new MemoryBackend();
    const inner = script([
      sse(
        invoke([{ name: "write", args: { path: "/a.md", content: "draft" } }]),
      ),
      sse(say("Saved.")),
    ]);
    const writer = new Agent({
      name: "writer",
      description: "Writes notes.",
      model: inner.model,
      tools: [workspace(backend)],
    });
    const outer = script([
      sse(invoke([{ name: "writer", args: { task: "Save a note." } }])),
      sse(say("Done.")),
    ]);
    const agent = new Agent({
      name: "agent",
      model: outer.model,
      tools: [writer],
    });
    const paused = await agent.run("Note this.", { session: "s" });
    expect(paused).toMatchObject({
      status: "paused",
      pending: [
        {
          id: "agent/1:writer/1",
          value: {
            tool: "write",
            input: { path: "/a.md", content: "draft" },
          },
        },
      ],
    });
    const done = await agent.run(
      { resume: { "agent/1:writer/1": { type: "approve" } } },
      { session: "s" },
    );
    expect(done.output).toMatchObject({ answer: "Done." });
    expect(await backend.read("/a.md")).toBe("draft");
    expect(tools(outer.requests[1] ?? {})).toEqual(["Saved."]);
  });

  it("reuses a cached tool result in a later run", async () => {
    let calls = 0;
    const cached = tool(
      () => {
        calls++;
        return "sunny";
      },
      {
        name: "weather",
        description: "Weather of a city.",
        policy: { cache: Infinity },
      },
    );
    const { model } = script([
      sse(invoke([{ name: "weather", args: { city: "Paris" } }])),
      sse(say("Sunny.")),
      sse(invoke([{ name: "weather", args: { city: "Paris" } }])),
      sse(say("Still sunny.")),
    ]);
    const agent = new Agent({ name: "agent", model, tools: [cached] });
    await agent.run("Weather?");
    const run = await agent.run("Weather again?");
    expect(run.output).toMatchObject({ answer: "Still sunny." });
    expect(calls).toBe(1);
  });

  it("retries a flaky tool with its policy", async () => {
    let calls = 0;
    const flaky = tool(
      () => {
        calls++;
        if (calls === 1) throw new Error("busy");
        return "sunny";
      },
      { name: "weather", description: "Weather of a city." },
    );
    const { model, requests } = script([
      sse(invoke([{ name: "weather", args: { city: "Paris" } }])),
      sse(say("Sunny.")),
    ]);
    const agent = new Agent({
      name: "agent",
      model,
      tools: [flaky],
      policy: { attempts: 2, delay: 0 },
    });
    const run = await agent.run("Weather in Paris?");
    expect(run.output).toMatchObject({ answer: "Sunny." });
    expect(tools(requests[1] ?? {})).toEqual(["sunny"]);
    expect(calls).toBe(2);
  });
});

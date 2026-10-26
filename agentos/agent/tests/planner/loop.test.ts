import {
  Execution,
  tool,
  Workflow,
  type Operator,
  type Values,
} from "@openagent/core";
import { describe, expect, it } from "vitest";

import { run } from "@openconsole/graph";

import { loop, type Model } from "../../index";
import { invoke, messages, say, script, sse } from "../../testing";
import { id } from "../support";

const city = {
  type: "object",
  properties: { city: { type: "string" } },
  required: ["city"],
};

const weather = tool(() => "sunny", {
  name: "weather",
  description: "Weather of a city.",
  schema: city,
});

const air = tool(() => ({ index: 30 }), {
  name: "air",
  description: "Air quality of a city.",
  schema: city,
});

function start(planner: Operator, input: Values, nodes = 100): Execution {
  const flow = new Workflow({ name: "flow" }).node("plan", planner);
  return new Execution(flow.template.copy(), {
    operators: flow.operators,
    input,
    scope: { run: "r", session: "s" },
    limits: { nodes },
  });
}

const plan = (model: Model, tools: readonly Operator[], instructions = "") =>
  loop()({ name: "loop", model, instructions, tools });

describe("loop", () => {
  it("turns every reply into a node and every call into a tool node", async () => {
    const { model, requests } = script([
      sse(
        invoke([
          { name: "weather", args: { city: "Beijing" } },
          { name: "air", args: { city: "Beijing" } },
        ]),
      ),
      sse(say("Good day for a run.")),
    ]);
    const planner = plan(model, [weather, air], "Help the user.");
    const session = start(planner, { task: "Can I run outside today?" });
    await run(session);

    expect(session.values["answer"]).toBe("Good day for a run.");
    expect(session.graph.nodes()).toEqual([
      "plan",
      "plan/1",
      "plan/2",
      "plan~1",
    ]);
    expect(session.graph.parent(id("plan/1"))).toBe("plan");
    expect(session.graph.parent(id("plan~1"))).toBeUndefined();
    expect(requests[0]?.["tools"]).toHaveLength(2);
    expect(messages(requests[0] ?? {})[0]).toEqual({
      role: "system",
      content: "Help the user.",
    });
    expect(messages(requests[1] ?? {}).slice(-2)).toEqual([
      { role: "tool", tool_call_id: "call_0", content: "sunny" },
      { role: "tool", tool_call_id: "call_1", content: '{"index":30}' },
    ]);
    expect(session.spent).toBe(30);
  });

  it("reports invalid calls back to the model", async () => {
    const { model, requests } = script([
      sse(
        invoke([
          { name: "weather", args: '{"city": ' },
          { name: "missing", args: {} },
          { name: "weather", args: {} },
        ]),
      ),
      sse(say("Sorry.")),
    ]);
    const session = start(plan(model, [weather]), { task: "?" });
    await run(session);

    const tools = messages(requests[1] ?? {}).filter(
      (message) => message["role"] === "tool",
    );
    expect(tools.map((message) => message["content"])).toEqual([
      '{"error":"arguments of weather are not valid JSON"}',
      '{"error":"unknown tool missing"}',
      expect.stringContaining("must have required property 'city'"),
    ]);
    expect(session.values["answer"]).toBe("Sorry.");
  });

  it("answers without tools near the recursion limit", async () => {
    const { model, requests } = script([
      sse(invoke([{ name: "weather", args: { city: "Paris" } }])),
      sse([
        ...invoke([{ name: "weather", args: { city: "Paris" } }]).slice(0, 2),
        ...say("Sunny in Paris."),
      ]),
    ]);
    const session = start(plan(model, [weather]), { task: "Paris?" }, 3);
    await run(session);
    expect(requests[0]).toMatchObject({ tool_choice: "auto" });
    expect(requests[1]).toMatchObject({ tool_choice: "none" });
    expect(session.graph.order).toBe(3);
    expect(session.values["answer"]).toBe("Sunny in Paris.");
  });

  it("starts from the given messages", async () => {
    const { model, requests } = script([sse(say("Hi!"))]);
    const session = start(plan(model, [], "Be brief."), {
      messages: [{ role: "user", content: "hello" }],
    });
    await run(session);
    expect(messages(requests[0] ?? {})).toEqual([
      { role: "system", content: "Be brief." },
      { role: "user", content: "hello" },
    ]);
    expect(session.values["messages"]).toHaveLength(2);
  });
});

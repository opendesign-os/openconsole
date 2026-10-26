import {
  Execution,
  tool,
  Workflow,
  type Operator,
  type Values,
} from "@openagent/core";
import { describe, expect, it } from "vitest";

import { run } from "@openconsole/graph";

import { compiler, type Model } from "../../index";
import { lines, messages, say, script, sse } from "../../testing";
import { id } from "../support";

const plan = (model: Model, tools: readonly Operator[], rounds?: number) =>
  compiler(rounds === undefined ? {} : { rounds })({
    name: "compiler",
    model,
    instructions: "",
    tools,
  });

const search = tool((input) => `found ${String(input["query"])}`, {
  name: "search",
  description: "Searches for a query.",
  schema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
});

const merge = tool(
  (input) => `${String(input["left"])} + ${String(input["right"])}`,
  {
    name: "merge",
    description: "Joins two texts.",
    schema: {
      type: "object",
      properties: { left: { type: "string" }, right: { type: "string" } },
      required: ["left", "right"],
    },
  },
);

function start(planner: Operator, input: Values): Execution {
  const flow = new Workflow({ name: "flow" }).node("plan", planner);
  return new Execution(flow.template.copy(), {
    operators: flow.operators,
    input,
    scope: { run: "r", session: "s" },
  });
}

describe("compiler", () => {
  it("streams a dependency plan into the graph and joins the results", async () => {
    const { model } = script([
      sse(
        lines(
          '{"id": 1, "tool": "search", "args": {"query": "x"}}',
          '{"id": 2, "tool": "search", "args": {"query": "y"}}',
          '{"id": 3, "tool": "merge", "args": {"left": "$1", "right": "$2.result"}}',
        ),
        5,
      ),
      (body) => {
        const user = String(messages(body)[1]?.["content"]);
        expect(user).toContain("found x + found y");
        return sse(say('{"answer": "found x + found y"}'));
      },
    ]);
    const planner = plan(model, [search, merge]);
    const session = start(planner, { task: "combine x and y" });
    const events: string[] = [];
    session.signal.on("start", ({ node }) => events.push(`start ${node}`));
    session.signal.on("finish", ({ node }) => events.push(`end ${node}`));
    await run(session);

    expect(session.values["answer"]).toBe("found x + found y");
    expect(session.graph.inNeighbors(id("plan/3")).sort()).toEqual([
      "plan/1",
      "plan/2",
    ]);
    expect(events.indexOf("start plan/1")).toBeLessThan(
      events.indexOf("end plan"),
    );
  });

  it("replans when the joiner asks for another round", async () => {
    const { model, requests } = script([
      sse(lines('{"id": 1, "tool": "search", "args": {"query": "x"}}')),
      sse(say('{"replan": "search y instead"}')),
      sse(lines('{"id": 1, "tool": "search", "args": {"query": "y"}}')),
      sse(say('{"answer": "found y"}')),
    ]);
    const planner = plan(model, [search], 2);
    const session = start(planner, { task: "find it" });
    await run(session);

    expect(session.values["answer"]).toBe("found y");
    expect(session.graph.hasNode(id("plan~2"))).toBe(true);
    expect(String(messages(requests[2] ?? {})[1]?.["content"])).toContain(
      "search y instead",
    );
  });

  it("turns bad lines into faults the joiner can see", async () => {
    const { model } = script([
      sse(
        lines(
          '{"id": 1, "tool": "teleport", "args": {}}',
          '{"id": 2, "tool": "search", "args": {"query": "$9"}}',
          "not json at all",
        ),
      ),
      (body) => {
        const user = String(messages(body)[1]?.["content"]);
        expect(user).toContain("unknown tool teleport");
        expect(user).toContain("unknown task $9");
        return sse(say('{"answer": "nothing found"}'));
      },
    ]);
    const planner = plan(model, [search]);
    const session = start(planner, {
      messages: [{ role: "user", content: "find it" }],
    });
    await run(session);
    expect(session.state(id("plan/1"))?.status).toBe("failed");
    expect(session.state(id("plan/2"))?.status).toBe("failed");
    expect(session.values["answer"]).toBe("nothing found");
  });
});

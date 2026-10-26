import { describe, expect, it } from "vitest";

import { Interrupted, run } from "@openconsole/graph";

import {
  assemble,
  GraphRecursionError,
  InvalidUpdateError,
  registry,
  Session,
  tool,
  type Context,
  type Kind,
  type Plan,
} from "../../index";
import { boom, double, finish, id, number, route, sum } from "../support";

const kinds = registry(number, double, sum, boom, finish, route);

function planner(work: (context: Context) => void): Kind {
  return {
    name: "planner",
    description: "Grows the graph.",
    plans: true,
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object", properties: {} },
    run: async (_, context) => {
      work(context);
      return {};
    },
  };
}

describe("Session", () => {
  it("runs in dependency order and gathers arrays in source order", async () => {
    const graph = assemble(
      {
        nodes: [
          { id: "a", kind: "double", values: { value: 1 } },
          { id: "b", kind: "double", values: { value: 2 } },
          { id: "c", kind: "sum" },
          { id: "f", kind: "finish" },
        ],
        edges: [
          { from: ["b", "result"], to: ["c", "values"] },
          { from: ["a", "result"], to: ["c", "values"] },
          { from: ["c", "result"], to: ["f", "value"] },
        ],
      },
      kinds,
    );
    const session = new Session(graph, { kinds });
    const started: string[] = [];
    session.signal.on("started", ({ node }) => started.push(node));
    await run(session);
    expect(session.result()).toEqual({ answer: 6 });
    expect(session.state(id("c"))?.input).toEqual({ values: [2, 4] });
    expect(started.indexOf("c")).toBeGreaterThan(started.indexOf("a"));
    expect(started.indexOf("c")).toBeGreaterThan(started.indexOf("b"));
  });

  it("passes a failure downstream as an error value", async () => {
    const graph = assemble(
      {
        nodes: [
          { id: "x", kind: "boom" },
          { id: "f", kind: "finish" },
        ],
        edges: [{ from: ["x", "result"], to: ["f", "value"] }],
      },
      kinds,
    );
    const session = new Session(graph, { kinds });
    await run(session);
    expect(session.state(id("x"))).toMatchObject({
      status: "failed",
      error: "boom failed",
    });
    expect(session.values).toEqual({ answer: { error: "boom failed" } });
  });

  it("skips nodes on a branch that never fires", async () => {
    const graph = assemble(
      {
        nodes: [
          { id: "r", kind: "route", values: { value: 5 } },
          { id: "left", kind: "double" },
          { id: "after", kind: "double" },
          { id: "right", kind: "double" },
        ],
        edges: [
          { from: ["r", "no"], to: ["left", "value"] },
          { from: ["left", "result"], to: ["after", "value"] },
          { from: ["r", "yes"], to: ["right", "value"] },
        ],
      },
      kinds,
    );
    const session = new Session(graph, { kinds });
    await run(session);
    expect(session.state(id("left"))?.status).toBe("skipped");
    expect(session.state(id("after"))?.status).toBe("skipped");
    expect(session.state(id("right"))?.outputs).toEqual({ result: 10 });
  });

  it("validates inputs and falls back to the run input", async () => {
    const graph = assemble(
      {
        nodes: [
          { id: "bad", kind: "double", values: { value: "two" } },
          { id: "shared", kind: "double" },
        ],
        edges: [],
      },
      kinds,
    );
    const session = new Session(graph, { kinds, input: { value: 21 } });
    await run(session);
    expect(session.state(id("bad"))?.status).toBe("failed");
    expect(session.state(id("bad"))?.error).toContain("is invalid");
    expect(session.state(id("shared"))?.outputs).toEqual({ result: 42 });
  });

  it("grows only from planners, append-only", async () => {
    const errors: string[] = [];
    const attempt = (context: Context, plan: Plan): void => {
      try {
        context.grow(plan);
      } catch (error) {
        errors.push(
          error instanceof InvalidUpdateError ? error.message : String(error),
        );
      }
    };
    const grower = planner((context) => {
      attempt(context, { steps: [{ id: id("p"), kind: "missing" }] });
      attempt(context, {
        steps: [
          { id: id("p"), kind: "double" },
          { id: id("p"), kind: "double" },
        ],
      });
      attempt(context, {
        steps: [{ id: id("q"), kind: "finish" }],
        edges: [{ from: [id("q"), "answer"], to: [context.node, "value"] }],
      });
      attempt(context, {
        steps: [
          { id: id("early"), kind: "finish" },
          { id: id("late"), kind: "double", values: { value: 1 } },
        ],
        edges: [{ from: [id("late"), "result"], to: [id("early"), "value"] }],
      });
      context.grow({
        steps: [
          { id: id("a"), kind: "double", values: { value: 3 } },
          { id: id("f"), kind: "finish" },
        ],
        edges: [{ from: [id("a"), "result"], to: [id("f"), "value"] }],
      });
    });
    const known = registry(grower, double, finish);
    const graph = assemble(
      { nodes: [{ id: "plan", kind: "planner" }], edges: [] },
      known,
    );
    const session = new Session(graph, { kinds: known });
    const grown: string[][] = [];
    session.signal.on("grown", ({ nodes }) => grown.push([...nodes]));
    await run(session);
    expect(errors).toEqual([
      "invalid graph update: unknown kind missing",
      "invalid graph update: node p already exists",
      "invalid graph update: edges may only enter new nodes, not plan",
      "invalid graph update: late must exist or come before early",
    ]);
    expect(grown).toEqual([["a", "f"]]);
    expect(graph.parent(id("a"))).toBe("plan");
    expect(session.values).toEqual({ answer: 6 });
  });

  it("rejects growth from nodes that cannot plan", async () => {
    const sneaky = tool(
      (_, context) =>
        context.grow({ steps: [{ id: id("x"), kind: "double" }] }),
      { name: "sneaky", description: "Tries to grow the graph." },
    );
    const known = registry(sneaky, double);
    const session = new Session(
      assemble({ nodes: [{ id: "s", kind: "sneaky" }], edges: [] }, known),
      { kinds: known },
    );
    await run(session);
    expect(session.state(id("s"))?.error).toBe(
      "invalid graph update: s cannot plan",
    );
  });

  it("stops growth at the recursion limit", async () => {
    let failure: unknown;
    let remaining = -1;
    const grower = planner((context) => {
      remaining = context.remaining;
      try {
        context.grow({
          steps: [
            { id: id("a"), kind: "double", values: { value: 1 } },
            { id: id("b"), kind: "double", values: { value: 1 } },
          ],
        });
      } catch (error) {
        failure = error;
      }
    });
    const known = registry(grower, double);
    const session = new Session(
      assemble({ nodes: [{ id: "plan", kind: "planner" }], edges: [] }, known),
      { kinds: known, recursionLimit: 2 },
    );
    await run(session);
    expect(remaining).toBe(1);
    expect(failure).toBeInstanceOf(GraphRecursionError);
  });

  it("caps how many nodes run at once", async () => {
    let active = 0;
    let peak = 0;
    const slow = tool(
      async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return 1;
      },
      { name: "slow", description: "Takes a moment." },
    );
    const known = registry(slow);
    const graph = assemble(
      {
        nodes: [
          { id: "a", kind: "slow" },
          { id: "b", kind: "slow" },
          { id: "c", kind: "slow" },
        ],
        edges: [],
      },
      known,
    );
    await run(new Session(graph, { kinds: known, maxConcurrency: 1 }));
    expect(peak).toBe(1);
  });

  it("cancels in-flight work and resumes on the next run", async () => {
    let calls = 0;
    const slow = tool(
      (_, context) => {
        calls++;
        if (calls > 1) return "fast";
        return new Promise((_, reject) => {
          context.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        });
      },
      { name: "slow", description: "Waits until aborted." },
    );
    const known = registry(slow, finish);
    const graph = assemble(
      {
        nodes: [
          { id: "s", kind: "slow" },
          { id: "f", kind: "finish" },
        ],
        edges: [{ from: ["s", "result"], to: ["f", "value"] }],
      },
      known,
    );
    const session = new Session(graph, { kinds: known });
    session.signal.once("started", () => {
      queueMicrotask(() => session.cancel());
    });
    await expect(run(session)).rejects.toBeInstanceOf(Interrupted);
    expect(session.state(id("s"))?.status).toBe("waiting");
    await run(session);
    expect(session.values).toEqual({ answer: "fast" });
  });
});

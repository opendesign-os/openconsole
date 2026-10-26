import { describe, expect, it } from "vitest";

import { Interrupted, run } from "@openconsole/graph";

import {
  assemble,
  Execution,
  LimitError,
  PlanError,
  registry,
  TimeoutError,
  tool,
  type Cache,
  type Context,
  type ExecutionOptions,
  type Operator,
  type Plan,
  type Policy,
} from "../../index";
import { boom, double, finish, id, number, route, sum } from "../support";

const operators = registry(number, double, sum, boom, finish, route);

const scope = { run: "r", session: "s" };

const start = (
  graph: ConstructorParameters<typeof Execution>[0],
  options: Omit<ExecutionOptions, "scope">,
) => new Execution(graph, { scope, ...options });

function planner(work: (context: Context) => void): Operator {
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

describe("Execution", () => {
  it("runs in dependency order and gathers arrays in source order", async () => {
    const graph = assemble(
      {
        nodes: [
          { id: "a", operator: "double", values: { value: 1 } },
          { id: "b", operator: "double", values: { value: 2 } },
          { id: "c", operator: "sum" },
          { id: "f", operator: "finish" },
        ],
        edges: [
          { from: ["b", "result"], to: ["c", "values"] },
          { from: ["a", "result"], to: ["c", "values"] },
          { from: ["c", "result"], to: ["f", "value"] },
        ],
      },
      operators,
    );
    const session = start(graph, { operators });
    const started: string[] = [];
    session.signal.on("start", ({ node }) => started.push(node));
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
          { id: "x", operator: "boom" },
          { id: "f", operator: "finish" },
        ],
        edges: [{ from: ["x", "result"], to: ["f", "value"] }],
      },
      operators,
    );
    const session = start(graph, { operators });
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
          { id: "r", operator: "route", values: { value: 5 } },
          { id: "left", operator: "double" },
          { id: "after", operator: "double" },
          { id: "right", operator: "double" },
        ],
        edges: [
          { from: ["r", "no"], to: ["left", "value"] },
          { from: ["left", "result"], to: ["after", "value"] },
          { from: ["r", "yes"], to: ["right", "value"] },
        ],
      },
      operators,
    );
    const session = start(graph, { operators });
    await run(session);
    expect(session.state(id("left"))?.status).toBe("skipped");
    expect(session.state(id("after"))?.status).toBe("skipped");
    expect(session.state(id("right"))?.outputs).toEqual({ result: 10 });
  });

  it("validates inputs and falls back to the run input", async () => {
    const graph = assemble(
      {
        nodes: [
          { id: "bad", operator: "double", values: { value: "two" } },
          { id: "shared", operator: "double" },
        ],
        edges: [],
      },
      operators,
    );
    const session = start(graph, { operators, input: { value: 21 } });
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
        errors.push(error instanceof PlanError ? error.message : String(error));
      }
    };
    const grower = planner((context) => {
      attempt(context, { steps: [{ id: id("p"), operator: "missing" }] });
      attempt(context, {
        steps: [
          { id: id("p"), operator: "double" },
          { id: id("p"), operator: "double" },
        ],
      });
      attempt(context, {
        steps: [{ id: id("q"), operator: "finish" }],
        edges: [{ from: [id("q"), "answer"], to: [context.node, "value"] }],
      });
      attempt(context, {
        steps: [
          { id: id("early"), operator: "finish" },
          { id: id("late"), operator: "double", values: { value: 1 } },
        ],
        edges: [{ from: [id("late"), "result"], to: [id("early"), "value"] }],
      });
      context.grow({
        steps: [
          { id: id("a"), operator: "double", values: { value: 3 } },
          { id: id("f"), operator: "finish" },
        ],
        edges: [{ from: [id("a"), "result"], to: [id("f"), "value"] }],
      });
    });
    const known = registry(grower, double, finish);
    const graph = assemble(
      { nodes: [{ id: "plan", operator: "planner" }], edges: [] },
      known,
    );
    const session = start(graph, { operators: known });
    const grown: string[][] = [];
    session.signal.on("grow", ({ plan }) =>
      grown.push(plan.steps.map((step) => step.id)),
    );
    await run(session);
    expect(errors).toEqual([
      "invalid plan: unknown operator missing",
      "invalid plan: node p already exists",
      "invalid plan: edges may only enter new nodes, not plan",
      "invalid plan: late must exist or come before early",
    ]);
    expect(grown).toEqual([["a", "f"]]);
    expect(graph.parent(id("a"))).toBe("plan");
    expect(session.values).toEqual({ answer: 6 });
  });

  it("rejects growth from nodes that cannot plan", async () => {
    const sneaky = tool(
      (_, context) =>
        context.grow({ steps: [{ id: id("x"), operator: "double" }] }),
      { name: "sneaky", description: "Tries to grow the graph." },
    );
    const known = registry(sneaky, double);
    const session = start(
      assemble({ nodes: [{ id: "s", operator: "sneaky" }], edges: [] }, known),
      { operators: known },
    );
    await run(session);
    expect(session.state(id("s"))?.error).toBe("invalid plan: s cannot plan");
  });

  it("stops growth at the recursion limit", async () => {
    let failure: unknown;
    let remaining = -1;
    const grower = planner((context) => {
      remaining = context.remaining;
      try {
        context.grow({
          steps: [
            { id: id("a"), operator: "double", values: { value: 1 } },
            { id: id("b"), operator: "double", values: { value: 1 } },
          ],
        });
      } catch (error) {
        failure = error;
      }
    });
    const known = registry(grower, double);
    const session = start(
      assemble(
        { nodes: [{ id: "plan", operator: "planner" }], edges: [] },
        known,
      ),
      { operators: known, limits: { nodes: 2 } },
    );
    await run(session);
    expect(remaining).toBe(1);
    expect(failure).toBeInstanceOf(LimitError);
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
          { id: "a", operator: "slow" },
          { id: "b", operator: "slow" },
          { id: "c", operator: "slow" },
        ],
        edges: [],
      },
      known,
    );
    await run(start(graph, { operators: known, limits: { concurrency: 1 } }));
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
          { id: "s", operator: "slow" },
          { id: "f", operator: "finish" },
        ],
        edges: [{ from: ["s", "result"], to: ["f", "value"] }],
      },
      known,
    );
    const session = start(graph, { operators: known });
    session.signal.once("start", () => {
      queueMicrotask(() => session.cancel());
    });
    await expect(run(session)).rejects.toBeInstanceOf(Interrupted);
    expect(session.state(id("s"))?.status).toBe("waiting");
    await run(session);
    expect(session.values).toEqual({ answer: "fast" });
  });

  it("retries a failing attempt and reports each retry", async () => {
    let calls = 0;
    const flaky = tool(
      () => {
        calls++;
        if (calls < 3) throw new Error(`failure ${calls}`);
        return "ok";
      },
      {
        name: "flaky",
        description: "Fails twice.",
        policy: { attempts: 3, delay: 0 },
      },
    );
    const known = registry(flaky, finish);
    const graph = assemble(
      {
        nodes: [
          { id: "x", operator: "flaky" },
          { id: "f", operator: "finish" },
        ],
        edges: [{ from: ["x", "result"], to: ["f", "value"] }],
      },
      known,
    );
    const session = start(graph, { operators: known });
    const retries: Array<readonly [number, string]> = [];
    session.signal.on("retry", ({ attempt, error }) =>
      retries.push([attempt, error]),
    );
    await run(session);
    expect(retries).toEqual([
      [1, "failure 1"],
      [2, "failure 2"],
    ]);
    expect(session.values).toEqual({ answer: "ok" });
  });

  it("stops retrying when attempts run out or the policy refuses", async () => {
    const calls = { plain: 0, single: 0, fatal: 0 };
    const failing = (name: keyof typeof calls, policy?: Policy): Operator =>
      tool(
        () => {
          calls[name]++;
          throw new Error(name);
        },
        {
          name,
          description: "Always fails.",
          ...(policy === undefined ? {} : { policy }),
        },
      );
    const known = registry(
      failing("plain"),
      failing("single", { attempts: 1 }),
      failing("fatal", { retry: (error) => String(error) !== "Error: fatal" }),
    );
    const graph = assemble(
      {
        nodes: [
          { id: "a", operator: "plain" },
          { id: "b", operator: "single" },
          { id: "c", operator: "fatal" },
        ],
        edges: [],
      },
      known,
    );
    await run(
      start(graph, { operators: known, policy: { attempts: 3, delay: 0 } }),
    );
    expect(calls).toEqual({ plain: 3, single: 1, fatal: 1 });
  });

  it("times out an attempt by aborting its signal", async () => {
    const reasons: unknown[] = [];
    let calls = 0;
    const slow = tool(
      (_, context) => {
        calls++;
        if (calls > 1) return "fast";
        return new Promise((_, reject) => {
          context.signal.addEventListener("abort", () => {
            reasons.push(context.signal.reason);
            reject(new Error("aborted"));
          });
        });
      },
      {
        name: "slow",
        description: "Hangs on its first attempt.",
        policy: { attempts: 2, delay: 0, timeout: 10 },
      },
    );
    const known = registry(slow, finish);
    const graph = assemble(
      {
        nodes: [
          { id: "s", operator: "slow" },
          { id: "f", operator: "finish" },
        ],
        edges: [{ from: ["s", "result"], to: ["f", "value"] }],
      },
      known,
    );
    const session = start(graph, { operators: known });
    const retries: string[] = [];
    session.signal.on("retry", ({ error }) => retries.push(error));
    await run(session);
    expect(reasons[0]).toBeInstanceOf(TimeoutError);
    expect(retries).toEqual(["the attempt took longer than 10 ms"]);
    expect(session.values).toEqual({ answer: "fast" });
  });

  it("recovers a failed node through the ports its fallback fills", async () => {
    const risky: Operator = {
      name: "risky",
      description: "Fails, then falls back through its no port.",
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: { yes: {}, no: {} } },
      run: () => Promise.reject(new Error("broken")),
      recover: async (error) => ({
        no: error instanceof Error ? error.message : String(error),
      }),
    };
    const known = registry(risky, finish);
    const graph = assemble(
      {
        nodes: [
          { id: "r", operator: "risky" },
          { id: "ok", operator: "finish" },
          { id: "fallback", operator: "finish" },
        ],
        edges: [
          { from: ["r", "yes"], to: ["ok", "value"] },
          { from: ["r", "no"], to: ["fallback", "value"] },
        ],
      },
      known,
    );
    const session = start(graph, { operators: known });
    await run(session);
    expect(session.state(id("r"))?.status).toBe("done");
    expect(session.state(id("ok"))?.status).toBe("skipped");
    expect(session.values).toEqual({ answer: "broken" });
  });

  it("does not retry a node that already grew the graph", async () => {
    let calls = 0;
    const grower: Operator = {
      ...planner((context) => {
        calls++;
        context.grow({
          steps: [
            { id: id(`n${calls}`), operator: "double", values: { value: 1 } },
          ],
        });
        throw new Error("failed after growing");
      }),
      policy: { attempts: 3, delay: 0 },
    };
    const known = registry(grower, double);
    const session = start(
      assemble(
        { nodes: [{ id: "plan", operator: "planner" }], edges: [] },
        known,
      ),
      { operators: known },
    );
    await run(session);
    expect(calls).toBe(1);
    expect(session.state(id("plan"))?.status).toBe("failed");
    expect(session.state(id("n1"))?.status).toBe("done");
  });

  describe("cache", () => {
    const counted = (cache: number) => {
      const calls = { count: 0 };
      const operator = tool(
        (input) => {
          calls.count++;
          return Number(input["value"]) * 10;
        },
        {
          name: "lookup",
          description: "Counts its calls.",
          schema: { type: "object", properties: { value: { type: "number" } } },
          policy: { cache },
        },
      );
      return { calls, operator };
    };

    const memory = (): Cache & { readonly keys: () => string[] } => {
      const entries = new Map<string, unknown>();
      return {
        get: async (key) => entries.get(key),
        put: async (key, value) => {
          entries.set(key, value);
        },
        keys: () => [...entries.keys()],
      };
    };

    const once = async (operator: Operator, cache: Cache, value: number) => {
      const known = registry(operator, finish);
      const graph = assemble(
        {
          nodes: [
            { id: "l", operator: "lookup", values: { value } },
            { id: "f", operator: "finish" },
          ],
          edges: [{ from: ["l", "result"], to: ["f", "value"] }],
        },
        known,
      );
      const session = start(graph, { operators: known, cache });
      let cached = false;
      session.signal.on("finish", (event) => {
        if (event.node === "l") cached = event.cached === true;
      });
      await run(session);
      return { answer: session.values["answer"], cached };
    };

    it("reuses outputs for the same operator and input", async () => {
      const { calls, operator } = counted(Infinity);
      const cache = memory();
      expect(await once(operator, cache, 1)).toEqual({
        answer: 10,
        cached: false,
      });
      expect(await once(operator, cache, 1)).toEqual({
        answer: 10,
        cached: true,
      });
      expect(await once(operator, cache, 2)).toEqual({
        answer: 20,
        cached: false,
      });
      expect(calls.count).toBe(2);
      expect(cache.keys().every((key) => key.startsWith("lookup/"))).toBe(true);
    });

    it("lets outputs expire", async () => {
      const { calls, operator } = counted(1);
      const cache = memory();
      await once(operator, cache, 1);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(await once(operator, cache, 1)).toMatchObject({ cached: false });
      expect(calls.count).toBe(2);
    });
  });
});

import { describe, expect, expectTypeOf, it } from "vitest";

import {
  LimitError,
  MemoryStore,
  nest,
  tool,
  Workflow,
  type Operator,
  type Run,
} from "../../index";
import { boom, double, finish, id } from "../support";

const ask: Operator = {
  name: "ask",
  description: "Asks a person and answers with the reply.",
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object", properties: { answer: {} } },
  run: async (_, context) => ({
    answer: context.interrupt({ question: "ok?" }),
  }),
};

const talk: Operator = {
  name: "talk",
  description: "Streams while it works.",
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object", properties: { answer: {} } },
  run: async (_, context) => {
    context.publish({ progress: 0.5 });
    context.emit("tok");
    return { answer: 1 };
  },
};

const flow = (name = "flow") => new Workflow({ name });

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of source) items.push(item);
  return items;
}

describe("Runner", () => {
  it("runs a workflow and returns the answer", async () => {
    const run = await flow()
      .node("a", double, { input: { value: 2 } })
      .node("f", finish)
      .edge("a", "f")
      .run({});
    expect(run).toMatchObject({
      status: "completed",
      output: { answer: 4 },
      pending: [],
    });
  });

  it("streams typed events that end with the run", async () => {
    const events = await collect(flow().node("w", talk).stream({}));
    expect(events.map((event) => event.type)).toEqual([
      "start",
      "data",
      "delta",
      "finish",
      "end",
    ]);
    const texts: string[] = [];
    for (const event of events) {
      if (event.type === "delta") texts.push(event.text);
      if (event.type === "end") expect(event.run.output).toEqual({ answer: 1 });
      if (event.type === "data") expectTypeOf(event.data).toBeUnknown();
    }
    expect(texts).toEqual(["tok"]);
  });

  it("pauses and resumes the run of a session", async () => {
    const workflow = flow().node("ask", ask);
    const paused = await workflow.run({}, { session: "s" });
    expect(paused).toMatchObject({
      status: "paused",
      pending: [{ id: "ask", value: { question: "ok?" } }],
    });
    const done = await workflow.run(
      { resume: { ask: "yes" } },
      { session: "s" },
    );
    expect(done).toMatchObject({
      id: paused.id,
      status: "completed",
      output: { answer: "yes" },
    });
    expect((await workflow.runs("s")).map((run) => run.status)).toEqual([
      "completed",
    ]);
  });

  it("resumes only the nodes it gets answers for", async () => {
    const workflow = flow().node("left", ask).node("right", ask);
    await workflow.run({}, { session: "s" });
    const half = await workflow.run(
      { resume: { left: "p" } },
      { session: "s" },
    );
    expect(half.pending.map((item) => item.id)).toEqual(["right"]);
    const done = await workflow.run(
      { resume: { right: "q" } },
      { session: "s" },
    );
    expect(done.status).toBe("completed");
  });

  it("rebuilds grown nodes from the log when resuming", async () => {
    let plans = 0;
    const planner: Operator = {
      name: "plan",
      description: "Grows a step that asks a person.",
      plans: true,
      uses: [ask],
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: {} },
      run: async (_, context) => {
        plans++;
        context.grow({ steps: [{ id: id("ask"), operator: "ask" }] });
        return {};
      },
    };
    const workflow = flow().node("plan", planner);
    const paused = await workflow.run({}, { session: "s" });
    expect(paused.pending.map((item) => item.id)).toEqual(["ask"]);
    const done = await workflow.run(
      { resume: { ask: "ok" } },
      { session: "s" },
    );
    expect(done.output).toEqual({ answer: "ok" });
    expect(plans).toBe(1);
  });

  it("throws when a failed node has nothing downstream and keeps the run", async () => {
    const workflow = flow().node("x", boom);
    await expect(workflow.run({}, { session: "s" })).rejects.toThrow(
      "boom failed",
    );
    expect(await workflow.runs("s")).toMatchObject([
      { status: "failed", error: "boom failed" },
    ]);
    await expect(collect(workflow.stream({}))).rejects.toThrow("boom failed");
  });

  it("hands a failure downstream instead of throwing", async () => {
    const run = await flow()
      .node("x", boom)
      .node("f", finish)
      .edge("x", "f")
      .run({});
    expect(run.output).toEqual({ answer: { error: "boom failed" } });
  });

  it("retries failed nodes on resume and keeps finished ones", async () => {
    const counter = { calls: 0 };
    let attempts = 0;
    const flaky: Operator = {
      name: "flaky",
      description: "Fails on its first attempt.",
      inputSchema: { type: "object", properties: { value: {} } },
      outputSchema: { type: "object", properties: { answer: {} } },
      run: async (input) => {
        attempts++;
        if (attempts === 1) throw new Error("try again");
        return { answer: input["value"] };
      },
    };
    const source = tool(() => ++counter.calls, {
      name: "source",
      description: "Counts its runs.",
    });
    const workflow = flow().node("a", source).node("f", flaky).edge("a", "f");
    await expect(workflow.run({}, { session: "s" })).rejects.toThrow(
      "try again",
    );
    const resumed = await workflow.run({ resume: {} }, { session: "s" });
    expect(resumed).toMatchObject({
      status: "completed",
      output: { answer: 1 },
    });
    expect(resumed.error).toBeUndefined();
    expect(counter.calls).toBe(1);
  });

  it("retries nodes with the runner's policy and streams each retry", async () => {
    let calls = 0;
    const flaky = tool(
      () => {
        calls++;
        if (calls === 1) throw new Error("busy");
        return calls;
      },
      { name: "flaky", description: "Fails once." },
    );
    const workflow = new Workflow({
      name: "flow",
      policy: { attempts: 2, delay: 0 },
    })
      .node("x", flaky)
      .node("f", finish)
      .edge("x", "f");
    const events = await collect(workflow.stream({}));
    expect(events.map((event) => event.type)).toEqual([
      "start",
      "retry",
      "finish",
      "start",
      "finish",
      "end",
    ]);
    expect(events.at(-1)).toMatchObject({ run: { output: { answer: 2 } } });
  });

  it("takes over a run whose process stopped", async () => {
    const store = new MemoryStore();
    let plans = 0;
    let release = (): void => {};
    const planner: Operator = {
      name: "plan",
      description: "Grows two steps, then stalls on its first run.",
      plans: true,
      uses: [double, finish],
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: {} },
      run: async (_, context) => {
        plans++;
        context.grow({
          steps: [
            { id: id("x"), operator: "double", values: { value: plans } },
            { id: id("f"), operator: "finish" },
          ],
          edges: [{ from: [id("x"), "result"], to: [id("f"), "value"] }],
        });
        if (plans === 1) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return {};
      },
    };
    const first = new Workflow({ name: "flow", store }).node("plan", planner);
    for await (const event of first.stream({}, { session: "s" })) {
      if (event.type === "finish" && event.node === "f") break;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    const copy = new MemoryStore();
    for (const collection of ["runs", "steps"]) {
      for (const [key, value] of await store.list(collection)) {
        await copy.put(collection, key, value);
      }
    }
    const second = new Workflow({ name: "flow", store: copy }).node(
      "plan",
      planner,
    );
    await expect(second.run({ resume: {} }, { session: "s" })).rejects.toThrow(
      "is still running",
    );
    for (const [key, record] of await copy.list("runs")) {
      await copy.put("runs", key, {
        ...(record as Run),
        updated: new Date(0).toISOString(),
      });
    }
    const resumed = await second.run({ resume: {} }, { session: "s" });
    expect(resumed).toMatchObject({
      status: "completed",
      output: { answer: 4 },
    });
    expect(plans).toBe(2);
    release();
  });

  it("needs an unfinished run to resume", async () => {
    const workflow = flow().node("a", double, { input: { value: 1 } });
    await expect(workflow.run({ resume: {} })).rejects.toThrow(
      "pass the session",
    );
    await workflow.run({}, { session: "s" });
    await expect(
      workflow.run({ resume: {} }, { session: "s" }),
    ).rejects.toThrow("has no run to resume");
  });

  it("caches plain outputs in its store, not plans, fallbacks or answers", async () => {
    const store = new MemoryStore();
    const counts = { plans: 0, fails: 0 };
    const planner: Operator = {
      name: "plan",
      description: "Grows one step.",
      plans: true,
      uses: [double],
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: {} },
      run: async (_, context) => {
        counts.plans++;
        context.grow({
          steps: [{ id: id("x"), operator: "double", values: { value: 1 } }],
        });
        return {};
      },
    };
    const broken: Operator = {
      name: "broken",
      description: "Fails, then falls back.",
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: { result: {} } },
      run: async () => {
        counts.fails++;
        throw new Error("no");
      },
      recover: async () => ({ result: "fallback" }),
    };
    const workflow = new Workflow({
      name: "flow",
      store,
      policy: { cache: Infinity },
    })
      .node("plan", planner)
      .node("broken", broken)
      .node("ask", ask);
    await workflow.run({}, { session: "s" });
    await workflow.run({ resume: { ask: "yes" } }, { session: "s" });
    const events = await collect(workflow.stream({}, { session: "t" }));
    expect(events.at(-1)).toMatchObject({ run: { status: "paused" } });
    expect(
      events.flatMap((event) =>
        event.type === "finish" && event.cached === true ? [event.node] : [],
      ),
    ).toEqual(["x"]);
    expect(counts).toEqual({ plans: 2, fails: 2 });
    expect(
      (await store.list("cache")).map(([key]) => key.split("/")[0]),
    ).toEqual(["double"]);
  });

  it("keeps every run of a session in its store", async () => {
    const store = new MemoryStore();
    const workflow = new Workflow({ name: "flow", store }).node("a", double, {
      input: { value: 1 },
    });
    const first = await workflow.run({}, { session: "s" });
    const second = await workflow.run({}, { session: "s" });
    expect((await workflow.runs("s")).map((run) => run.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(await store.list("steps", `${first.id}/`)).toHaveLength(1);
  });

  it("nests a runner as a node", async () => {
    const inner = flow("inner").node("w", talk);
    const outer = flow("outer")
      .node("inner", inner, { input: { task: "go" } })
      .node("f", finish)
      .edge("inner", "f");
    const events = await collect(outer.stream({}));
    expect(
      events.flatMap((event) => (event.type === "delta" ? [event.text] : [])),
    ).toEqual(["tok"]);
    expect(events.at(-1)).toMatchObject({
      type: "end",
      run: { output: { answer: 1 } },
    });
  });

  it("pauses with a nested run and resumes it through a path id", async () => {
    const inner = flow("inner").node("ask", ask);
    const middle = flow("middle")
      .node("inner", inner, { input: { task: "go" } })
      .node("f", finish)
      .edge("inner", "f");
    const outer = flow("outer")
      .node("middle", middle, { input: { task: "go" } })
      .node("f", finish)
      .edge("middle", "f");
    const paused = await outer.run({}, { session: "s" });
    expect(paused).toMatchObject({
      status: "paused",
      pending: [{ id: "middle:inner:ask", value: { question: "ok?" } }],
    });
    const done = await outer.run(
      { resume: { "middle:inner:ask": "yes" } },
      { session: "s" },
    );
    expect(done).toMatchObject({
      status: "completed",
      output: { answer: "yes" },
    });
  });

  it("keeps the answers of a nested node that pauses again", async () => {
    const twice: Operator = {
      name: "twice",
      description: "Asks two questions in a row.",
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: { answer: {} } },
      run: async (_, context) => ({
        answer: [context.interrupt("first"), context.interrupt("second")],
      }),
    };
    const outer = flow("outer")
      .node("inner", flow("inner").node("twice", twice), {
        input: { task: "go" },
      })
      .node("f", finish)
      .edge("inner", "f");
    const first = await outer.run({}, { session: "s" });
    expect(first.pending).toEqual([{ id: "inner:twice", value: "first" }]);
    const second = await outer.run(
      { resume: { "inner:twice": 1 } },
      { session: "s" },
    );
    expect(second.pending).toEqual([{ id: "inner:twice", value: "second" }]);
    const done = await outer.run(
      { resume: { "inner:twice": 2 } },
      { session: "s" },
    );
    expect(done.output).toEqual({ answer: [1, 2] });
  });

  it("lets a node pause before and inside its nested run", async () => {
    const inner = nest(flow("inner").node("ask", ask));
    const gated: Operator = {
      ...inner,
      run: async (input, context) =>
        context.interrupt("start?") === true
          ? inner.run(input, context)
          : { result: "skipped" },
    };
    const outer = flow("outer")
      .node("inner", gated, { input: { task: "go" } })
      .node("f", finish)
      .edge("inner", "f");
    const first = await outer.run({}, { session: "s" });
    expect(first.pending).toEqual([{ id: "inner", value: "start?" }]);
    const second = await outer.run(
      { resume: { inner: true } },
      { session: "s" },
    );
    expect(second.pending).toEqual([
      { id: "inner:ask", value: { question: "ok?" } },
    ]);
    const done = await outer.run(
      { resume: { "inner:ask": "yes" } },
      { session: "s" },
    );
    expect(done.output).toEqual({ answer: "yes" });
  });

  it("applies run limits", async () => {
    const planner: Operator = {
      name: "plan",
      description: "Grows one step.",
      plans: true,
      uses: [double],
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: {} },
      run: async (_, context) => {
        context.grow({
          steps: [{ id: id("x"), operator: "double", values: { value: 1 } }],
        });
        return {};
      },
    };
    await expect(
      flow()
        .node("plan", planner)
        .run({}, { limits: { nodes: 1 } }),
    ).rejects.toBeInstanceOf(LimitError);
  });
});

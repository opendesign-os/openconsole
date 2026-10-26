import { describe, expect, it } from "vitest";

import {
  Command,
  FlowGraph,
  GraphValueError,
  MemorySaver,
  tool,
  type Kind,
  type StateSnapshot,
} from "../../index";
import { double, finish, number } from "../support";

const ask: Kind = {
  name: "ask",
  description: "Asks a person and answers with the reply.",
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object", properties: { answer: {} } },
  run: async (_, context) => ({
    answer: context.interrupt({ question: "ok?" }),
  }),
};

const chat: Kind = {
  name: "chat",
  description: "Echoes how many messages it has seen.",
  inputSchema: { type: "object", properties: { messages: { type: "array" } } },
  outputSchema: {
    type: "object",
    properties: { messages: { type: "array" }, answer: {} },
  },
  run: async (input) => {
    const seen = input["messages"] as unknown[];
    return {
      messages: [
        ...seen,
        { role: "assistant", content: `seen ${seen.length}` },
      ],
      answer: seen.length,
    };
  },
};

const thread = (name: string) => ({ configurable: { thread_id: name } });

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of source) items.push(item);
  return items;
}

function chain(counter: { calls: number }) {
  const source = tool(() => ++counter.calls, {
    name: "source",
    description: "Counts its runs.",
  });
  return new FlowGraph()
    .addNode("a", source)
    .addNode("b", double)
    .addNode("f", finish)
    .addEdge("a", "b")
    .addEdge("b", "f");
}

describe("CompiledFlowGraph", () => {
  it("returns the outputs of the answering node", async () => {
    const graph = new FlowGraph()
      .addNode("a", double, { input: { value: 2 } })
      .addNode("f", finish)
      .addEdge("a", "f")
      .compile();
    expect(await graph.invoke({})).toEqual({ answer: 4 });
  });

  it("streams updates, values, messages and custom chunks", async () => {
    const talk: Kind = {
      name: "talk",
      description: "Streams while it works.",
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: { answer: {} } },
      run: async (_, context) => {
        context.writer({ progress: 0.5 });
        context.emit("tok");
        return { answer: 1 };
      },
    };
    const graph = new FlowGraph().addNode("w", talk).compile();
    const chunks = await collect(
      await graph.stream(
        {},
        { streamMode: ["updates", "values", "messages", "custom"] },
      ),
    );
    expect(chunks).toEqual([
      ["custom", { progress: 0.5 }],
      ["messages", ["tok", { node: "w" }]],
      ["updates", { w: { answer: 1 } }],
      ["values", { answer: 1 }],
    ]);
    const updates = await collect(
      await graph.stream({}, { streamMode: "updates" }),
    );
    expect(updates).toEqual([{ w: { answer: 1 } }]);
  });

  it("saves checkpoints per thread", async () => {
    const graph = chain({ calls: 0 }).compile({
      checkpointer: new MemorySaver(),
    });
    await graph.invoke({}, thread("t"));
    const state = await graph.getState(thread("t"));
    expect(state.values).toEqual({ answer: 2 });
    expect(state.next).toEqual([]);
    expect(state.tasks.map((task) => [task.id, task.status])).toEqual([
      ["a", "done"],
      ["b", "done"],
      ["f", "done"],
    ]);
    const history = await collect(graph.getStateHistory(thread("t")));
    expect(history.length).toBeGreaterThan(2);
    expect(history[0]?.config).toEqual(state.config);
    expect(history[0]?.parentConfig).toEqual(history[1]?.config);
  });

  it("pauses on interrupt and resumes with a command", async () => {
    const graph = new FlowGraph()
      .addNode("ask", ask)
      .compile({ checkpointer: new MemorySaver() });
    const paused = await graph.invoke({}, thread("t"));
    expect(paused).toEqual({
      __interrupt__: [{ id: "ask", value: { question: "ok?" } }],
    });
    expect((await graph.getState(thread("t"))).next).toEqual(["ask"]);
    const done = await graph.invoke(
      new Command({ resume: "yes" }),
      thread("t"),
    );
    expect(done).toEqual({ answer: "yes" });
  });

  it("needs a resume map when several nodes wait", async () => {
    const graph = new FlowGraph()
      .addNode("left", ask)
      .addNode("right", ask)
      .compile({ checkpointer: new MemorySaver() });
    await graph.invoke({}, thread("t"));
    await expect(
      graph.invoke(new Command({ resume: "x" }), thread("t")),
    ).rejects.toBeInstanceOf(GraphValueError);
    await graph.invoke(
      new Command({ resume: { left: "p", right: "q" } }),
      thread("t"),
    );
    const { tasks } = await graph.getState(thread("t"));
    expect(tasks.map((task) => task.result)).toEqual([
      { answer: "p" },
      { answer: "q" },
    ]);
  });

  it("stops before and after chosen nodes", async () => {
    const flow = new FlowGraph()
      .addNode("n", number, { input: { value: 3 } })
      .addNode("d", double)
      .addNode("f", finish)
      .addEdge("n", "d")
      .addEdge("d", "f");

    const before = flow.compile({
      checkpointer: new MemorySaver(),
      interruptBefore: ["double"],
    });
    expect(await before.invoke({}, thread("t"))).toEqual({
      __interrupt__: [{ id: "d", value: { node: "d", kind: "double" } }],
    });
    expect(await before.invoke(null, thread("t"))).toEqual({ answer: 6 });

    const after = flow.compile({
      checkpointer: new MemorySaver(),
      interruptAfter: ["n"],
    });
    expect(await after.invoke({}, thread("t"))).toEqual({});
    expect((await after.getState(thread("t"))).next).toEqual(["d"]);
    expect(await after.invoke(null, thread("t"))).toEqual({ answer: 6 });
  });

  it("updates a node and reruns only what depends on it", async () => {
    const counter = { calls: 0 };
    const graph = chain(counter).compile({ checkpointer: new MemorySaver() });
    expect(await graph.invoke({}, thread("t"))).toEqual({ answer: 2 });
    const config = await graph.updateState(thread("t"), { result: 10 }, "a");
    expect(config.configurable?.checkpoint_id).toBeDefined();
    expect((await graph.getState(thread("t"))).next).toEqual(["b"]);
    expect(await graph.invoke(null, thread("t"))).toEqual({ answer: 20 });
    expect(counter.calls).toBe(1);
  });

  it("continues from an earlier checkpoint", async () => {
    const counter = { calls: 0 };
    const graph = chain(counter).compile({ checkpointer: new MemorySaver() });
    await graph.invoke({}, thread("t"));
    let early: StateSnapshot | undefined;
    for await (const snapshot of graph.getStateHistory(thread("t"))) {
      if (snapshot.next.includes("b")) early = snapshot;
    }
    expect(early).toBeDefined();
    const forked = await graph.invoke(null, early?.config ?? {});
    expect(forked).toEqual({ answer: 2 });
    expect(counter.calls).toBe(1);
  });

  it("merges messages across runs on a thread", async () => {
    const graph = new FlowGraph()
      .addNode("chat", chat)
      .compile({ checkpointer: new MemorySaver() });
    await graph.invoke(
      { messages: [{ role: "user", content: "one" }] },
      thread("t"),
    );
    const second = await graph.invoke(
      { messages: [{ role: "user", content: "two" }] },
      thread("t"),
    );
    expect(second["answer"]).toBe(3);
    expect(await graph.invoke({ messages: [] }, thread("other"))).toMatchObject(
      {
        answer: 0,
      },
    );
  });

  it("needs a checkpointer and a thread to look back", async () => {
    const graph = new FlowGraph().addNode("ask", ask).compile();
    await expect(
      graph.invoke(new Command({ resume: 1 }), thread("t")),
    ).rejects.toBeInstanceOf(GraphValueError);
    await expect(graph.getState(thread("t"))).rejects.toBeInstanceOf(
      GraphValueError,
    );
  });
});

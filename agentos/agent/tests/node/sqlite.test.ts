/// <reference types="node" />

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent, MemoryBackend, workspace } from "../../index";
import { SqliteStore } from "../../node";
import { invoke, say, script, sse } from "../../testing";

describe("SqliteStore", () => {
  let root = "";
  const open: SqliteStore[] = [];
  const connect = (name: string) => {
    const created = new SqliteStore(join(root, name));
    open.push(created);
    return created;
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "sqlite-"));
  });

  afterEach(async () => {
    for (const item of open.splice(0)) item.close();
    await rm(root, { recursive: true, force: true });
  });

  it("keeps records by collection and lists them by prefix in key order", async () => {
    const store = connect("store.db");
    await store.put("runs", "s/2", { n: 2 });
    await store.put("runs", "s/1", { n: 1 });
    await store.put("runs", "t/1", { n: 3 });
    await store.put("runs", "s/1", { n: 4 });
    expect(await store.get("runs", "s/1")).toEqual({ n: 4 });
    expect(await store.get("runs", "missing")).toBeUndefined();
    expect(await store.list("runs", "s/")).toEqual([
      ["s/1", { n: 4 }],
      ["s/2", { n: 2 }],
    ]);
  });

  it("lets another agent resume a paused run from the same file", async () => {
    const backend = new MemoryBackend();
    const first = new Agent({
      name: "agent",
      model: script([
        sse(invoke([{ name: "write", args: { path: "/a.md", content: "x" } }])),
      ]).model,
      tools: [workspace(backend)],
      store: connect("agent.db"),
    });
    const paused = await first.run("Save it.", { session: "s" });
    expect(paused.status).toBe("paused");

    const second = new Agent({
      name: "agent",
      model: script([sse(say("Saved."))]).model,
      tools: [workspace(backend)],
      store: connect("agent.db"),
    });
    const done = await second.run(
      { resume: { "agent/1": { type: "approve" } } },
      { session: "s" },
    );
    expect(done).toMatchObject({
      id: paused.id,
      status: "completed",
      output: { answer: "Saved." },
    });
    expect(await backend.read("/a.md")).toBe("x");
  });
});

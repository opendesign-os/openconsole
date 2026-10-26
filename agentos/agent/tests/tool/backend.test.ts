/// <reference types="node" />

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { glob, MemoryBackend, normalize } from "../../index";
import { DiskBackend } from "../../node";

describe("backends", () => {
  it("normalizes paths inside the workspace", () => {
    expect(normalize("a/./b//c")).toBe("/a/b/c");
    expect(normalize("/a/b/../c")).toBe("/a/c");
    expect(() => normalize("/../etc/passwd")).toThrow("outside the workspace");
  });

  it("matches glob patterns", () => {
    expect(glob("/notes/**/*.md").test("/notes/a.md")).toBe(true);
    expect(glob("/notes/**/*.md").test("/notes/x/y.md")).toBe(true);
    expect(glob("*.md").test("/a.md")).toBe(true);
    expect(glob("*.md").test("/x/a.md")).toBe(false);
    expect(glob("/a?.txt").test("/ab.txt")).toBe(true);
  });

  it("keeps files in memory", async () => {
    const backend = new MemoryBackend();
    await backend.write("b.md", "2");
    await backend.write("/a/../a.md", "1");
    expect(await backend.list()).toEqual(["/a.md", "/b.md"]);
    expect(await backend.read("/a.md")).toBe("1");
    expect(await backend.read("/missing")).toBeUndefined();
  });

  it("keeps files on disk under its root", async () => {
    const root = await mkdtemp(join(tmpdir(), "workspace-"));
    try {
      const backend = new DiskBackend(root);
      expect(await backend.list()).toEqual([]);
      await backend.write("/notes/a.md", "1");
      await backend.write("/b.md", "2");
      expect(await backend.list()).toEqual(["/b.md", "/notes/a.md"]);
      expect(await backend.read("/notes/a.md")).toBe("1");
      expect(await backend.read("/missing.md")).toBeUndefined();
      await expect(backend.write("/../escape.md", "x")).rejects.toThrow(
        "outside the workspace",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

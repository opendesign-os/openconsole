/// <reference types="node" />

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = join(import.meta.dirname, "..", "src");

const LAYERS: Readonly<Record<string, readonly string[]>> = {
  model: [],
  memory: ["model"],
  tool: [],
  planner: ["model"],
  plugin: ["model", "memory", "planner"],
  agent: ["model", "planner", "plugin", "tool"],
  optimizer: ["model"],
  node: ["tool"],
};

const imports = (file: string): string[] =>
  [...readFileSync(file, "utf8").matchAll(/from "([^"]+)"/g)].map(
    (match) => match[1] ?? "",
  );

const local = (path: string): string =>
  relative(SOURCE, path).replaceAll("\\", "/");

const sources = (layer: string): string[] => {
  const folder = join(SOURCE, layer);
  if (!existsSync(folder)) return [`${folder}.ts`];
  return readdirSync(folder)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(folder, name));
};

describe("layering", () => {
  it("knows every layer", () => {
    const layers = readdirSync(SOURCE)
      .map((name) => basename(name, ".ts"))
      .filter((name) => name !== "index");
    expect(layers.sort()).toEqual(Object.keys(LAYERS).sort());
  });

  it.each(Object.entries(LAYERS))(
    "%s depends only on the layers below it",
    (layer, allowed) => {
      const offenders = sources(layer).flatMap((file) =>
        imports(file)
          .filter((source) => source.startsWith("."))
          .map((source) => local(resolve(dirname(file), source)))
          .filter((target) => !target.startsWith(`${layer}/`))
          .filter((target) => !allowed.includes(target))
          .map((target) => `${local(file)} -> ${target}`),
      );
      expect(offenders).toEqual([]);
    },
  );
});

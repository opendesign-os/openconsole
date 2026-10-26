/// <reference types="node" />

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CORE = join(import.meta.dirname, "..", "core");

const LAYERS: Readonly<Record<string, readonly string[]>> = {
  common: [],
  model: ["common"],
  runtime: ["common"],
  node: ["common", "model"],
  planner: ["common", "model"],
  graph: ["common", "runtime"],
  prebuilt: ["common", "model", "planner", "graph"],
  optimize: ["common", "model", "runtime", "node", "graph"],
};

const importsOf = (file: string): string[] =>
  [...readFileSync(file, "utf8").matchAll(/from "([^"]+)"/g)].map(
    (match) => match[1] ?? "",
  );

const sources = (layer: string): string[] =>
  readdirSync(join(CORE, layer))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(CORE, layer, name));

describe("layering", () => {
  it("knows every layer folder", () => {
    const folders = readdirSync(CORE, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(folders.sort()).toEqual(Object.keys(LAYERS).sort());
  });

  it.each(Object.entries(LAYERS))(
    "%s depends only on the layers below it",
    (layer, allowed) => {
      const offenders = sources(layer).flatMap((file) =>
        importsOf(file)
          .filter((source) => source.startsWith("../"))
          .filter((source) => !allowed.includes(source.slice(3)))
          .map(
            (source) => `${layer}/${file.split(/[\\/]/).at(-1)} -> ${source}`,
          ),
      );
      expect(offenders).toEqual([]);
    },
  );
});

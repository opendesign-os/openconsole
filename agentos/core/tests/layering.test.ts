/// <reference types="node" />

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = join(import.meta.dirname, "..", "src");

const LAYERS: Readonly<Record<string, readonly string[]>> = {
  graph: [],
  engine: ["graph"],
  storage: [],
  runtime: ["graph", "engine", "storage"],
};

const imports = (file: string): string[] =>
  [...readFileSync(file, "utf8").matchAll(/from "([^"]+)"/g)].map(
    (match) => match[1] ?? "",
  );

const sources = (layer: string): string[] =>
  readdirSync(join(SOURCE, layer))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(SOURCE, layer, name));

describe("layering", () => {
  it("knows every layer folder", () => {
    const folders = readdirSync(SOURCE, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(folders.sort()).toEqual(Object.keys(LAYERS).sort());
  });

  it.each(Object.entries(LAYERS))(
    "%s depends only on the layers below it",
    (layer, allowed) => {
      const offenders = sources(layer).flatMap((file) =>
        imports(file)
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

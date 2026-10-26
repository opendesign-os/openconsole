/// <reference types="node" />

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

import { normalize, type Backend } from "../tool";

export class DiskBackend implements Backend {
  public constructor(private readonly _root: string) {}

  public async list(): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(this._root, {
        recursive: true,
        withFileTypes: true,
      });
    } catch (error) {
      if (missing(error)) return [];
      throw error;
    }
    return entries
      .filter((entry) => entry.isFile())
      .map(
        (entry) =>
          `/${relative(this._root, join(entry.parentPath, entry.name)).split(sep).join("/")}`,
      )
      .sort();
  }

  public async read(path: string): Promise<string | undefined> {
    try {
      return await readFile(this._resolve(path), "utf8");
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
  }

  public async write(path: string, content: string): Promise<void> {
    const target = this._resolve(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }

  private _resolve(path: string): string {
    return join(this._root, ...normalize(path).split("/"));
  }
}

function missing(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "ENOENT";
}

import { tool, type Operator } from "@openagent/core";

import { MemoryBackend, normalize, type Backend } from "./backend";
import { confirm } from "./confirm";
import type { Toolkit } from "./toolkit";

export interface WorkspaceOptions {
  readonly confirm?: readonly string[];
}

const GUIDE =
  "You have a workspace of files at absolute paths such as /notes.md. Keep plans, notes and intermediate results there instead of in the conversation, using ls, read, write, edit, glob and grep.";

const MATCHES = 200;

export function workspace(
  backend: Backend = new MemoryBackend(),
  options: WorkspaceOptions = {},
): Toolkit {
  const gated = new Set(options.confirm ?? ["write", "edit"]);
  return {
    name: "workspace",
    instructions: GUIDE,
    tools: files(backend).map((operator) =>
      gated.has(operator.name) ? confirm(operator) : operator,
    ),
  };
}

function files(backend: Backend): Operator[] {
  const path = {
    type: "string",
    description: "Absolute path such as /notes.md",
  };
  const under = (file: string, prefix: string): boolean =>
    prefix === "/" || file === prefix || file.startsWith(`${prefix}/`);
  const load = async (target: string): Promise<string> => {
    const content = await backend.read(target);
    if (content === undefined) throw new Error(`${target} does not exist`);
    return content;
  };
  return [
    tool(
      async (input) => {
        const prefix = normalize(String(input["path"] ?? "/"));
        const found = (await backend.list()).filter((file) =>
          under(file, prefix),
        );
        return found.length === 0 ? "No files found" : found.join("\n");
      },
      {
        name: "ls",
        description: "List the workspace files, optionally under a directory.",
        schema: { type: "object", properties: { path } },
      },
    ),
    tool(
      async (input) => {
        const lines = (await load(normalize(String(input["path"])))).split(
          "\n",
        );
        const offset = Number(input["offset"] ?? 0);
        const page = lines.slice(
          offset,
          offset + Number(input["limit"] ?? 2_000),
        );
        const rest = lines.length - offset - page.length;
        return rest > 0
          ? `${page.join("\n")}\n[${rest} more lines; read again with offset ${offset + page.length}]`
          : page.join("\n");
      },
      {
        name: "read",
        description:
          "Read a workspace file. Long files are read page by page with offset and limit, counted in lines.",
        schema: {
          type: "object",
          properties: {
            path,
            offset: { type: "integer", minimum: 0 },
            limit: { type: "integer", minimum: 1 },
          },
          required: ["path"],
        },
      },
    ),
    tool(
      async (input) => {
        const target = normalize(String(input["path"]));
        await backend.write(target, String(input["content"]));
        return `Wrote ${target}`;
      },
      {
        name: "write",
        description: "Create a workspace file or replace its content.",
        schema: {
          type: "object",
          properties: { path, content: { type: "string" } },
          required: ["path", "content"],
        },
      },
    ),
    tool(
      async (input) => {
        const target = normalize(String(input["path"]));
        const parts = (await load(target)).split(String(input["old"]));
        const count = parts.length - 1;
        if (count === 0) throw new Error(`the old text is not in ${target}`);
        if (count > 1 && input["all"] !== true) {
          throw new Error(
            `the old text appears ${count} times in ${target}; add context or set all`,
          );
        }
        await backend.write(target, parts.join(String(input["new"])));
        return `Edited ${target} (${count} ${count === 1 ? "change" : "changes"})`;
      },
      {
        name: "edit",
        description: "Replace exact text in a workspace file.",
        schema: {
          type: "object",
          properties: {
            path,
            old: { type: "string", minLength: 1 },
            new: { type: "string" },
            all: { type: "boolean" },
          },
          required: ["path", "old", "new"],
        },
      },
    ),
    tool(
      async (input) => {
        const pattern = glob(String(input["pattern"]));
        const found = (await backend.list()).filter((file) =>
          pattern.test(file),
        );
        return found.length === 0 ? "No files found" : found.join("\n");
      },
      {
        name: "glob",
        description:
          "Find workspace files by glob pattern, such as /notes/**/*.md.",
        schema: {
          type: "object",
          properties: { pattern: { type: "string" } },
          required: ["pattern"],
        },
      },
    ),
    tool(
      async (input) => {
        const pattern = new RegExp(String(input["pattern"]));
        const prefix = normalize(String(input["path"] ?? "/"));
        const found: string[] = [];
        for (const file of await backend.list()) {
          if (!under(file, prefix)) continue;
          const lines = (await backend.read(file))?.split("\n") ?? [];
          lines.forEach((line, index) => {
            if (pattern.test(line)) found.push(`${file}:${index + 1}: ${line}`);
          });
          if (found.length >= MATCHES) break;
        }
        return found.length === 0
          ? "No matches found"
          : found.slice(0, MATCHES).join("\n");
      },
      {
        name: "grep",
        description:
          "Search workspace files for lines matching a regular expression.",
        schema: {
          type: "object",
          properties: { pattern: { type: "string" }, path },
          required: ["pattern"],
        },
      },
    ),
  ];
}

export function glob(pattern: string): RegExp {
  const source = pattern.startsWith("/") ? pattern : `/${pattern}`;
  let expression = "";
  for (let index = 0; index < source.length; index++) {
    const char = source.charAt(index);
    if (char === "*" && source.charAt(index + 1) === "*") {
      expression += ".*";
      index += source.charAt(index + 2) === "/" ? 2 : 1;
    } else if (char === "*") {
      expression += "[^/]*";
    } else if (char === "?") {
      expression += "[^/]";
    } else {
      expression += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${expression}$`);
}

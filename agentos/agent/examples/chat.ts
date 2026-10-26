/// <reference types="node" />

import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { styleText } from "node:util";
import {
  Agent,
  APIError,
  compress,
  history,
  workspace,
  type Input,
} from "@openagent/agent";
import { DiskBackend, SqliteStore } from "@openagent/agent/node";
import { tool, type Run } from "@openagent/core";

const now = tool(() => new Date().toLocaleString(), {
  name: "now",
  description: "查询当前的本地日期和时间",
});

const agent = new Agent({
  name: "assistant",
  model: {
    baseURL: process.env.OPENAI_BASE_URL ?? "",
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_MODEL ?? "",
  },
  instructions: "你是一个乐于助人的助手，回答简洁。",
  store: new SqliteStore("chat.db"),
  tools: [now, workspace(new DiskBackend("workspace"))],
  plugins: [history(3), compress()],
  policy: {
    attempts: 3,
    timeout: 120_000,
    retry: (error) => !(error instanceof APIError),
  },
});
const session = "cli";

const terminal = createInterface({ input: stdin, output: stdout });
terminal.on("close", () => process.exit(0));

const brief = (value: unknown): string =>
  String(value).replace(/\s+/g, " ").slice(0, 80);

async function agree(question: string): Promise<boolean> {
  const answer = await terminal.question(`${question}(y/n) `);
  return answer.trim().toLowerCase() === "y";
}

async function reply(input: Input): Promise<Run | undefined> {
  let open = false;
  let last: Run | undefined;
  const note = (text: string): void => {
    stdout.write(`${open ? "\n" : ""}${styleText("dim", `  · ${text}`)}\n`);
    open = false;
  };
  for await (const event of agent.stream(input, { session })) {
    if (event.type === "delta" && !event.node.includes("/")) {
      stdout.write(`${open ? "" : "助手："}${event.text}`);
      open = true;
    } else if (event.type === "retry") {
      note(
        `${event.node} 第 ${event.attempt} 次失败：${brief(event.error)}，重试中`,
      );
    } else if (event.type === "finish" && "result" in event.outputs) {
      const source = event.cached ? "（缓存）" : "";
      note(`${event.node} → ${brief(event.outputs["result"])}${source}`);
    } else if (event.type === "end") {
      last = event.run;
    }
  }
  if (open) stdout.write("\n");
  return last;
}

async function settle(start: Run | undefined): Promise<void> {
  let run = start;
  while (run?.status === "paused") {
    const resume: Record<string, unknown> = {};
    for (const { id, value } of run.pending) {
      resume[id] = (await agree(`${JSON.stringify(value)} 允许吗？`))
        ? { type: "approve" }
        : { type: "reject" };
    }
    run = await reply({ resume });
  }
}

const last = (await agent.runs(session)).at(-1);
if (
  last !== undefined &&
  last.status !== "completed" &&
  (await agree(`上次的运行没跑完（${last.status}），接着跑吗？`))
) {
  await settle(last.status === "paused" ? last : await reply({ resume: {} }));
}

for (;;) {
  const content = (await terminal.question("\n你：")).trim();
  if (content === "") continue;
  await settle(await reply(content));
}

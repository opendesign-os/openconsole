import { tool, type Operator, type Store } from "@openagent/core";

import type { Bundle } from "@openconsole/graph";
import { definePlugin } from "@openconsole/plugable";

import {
  approximate,
  distill,
  Memory,
  type Entity,
  type Episode,
  type Fact,
} from "../memory";
import { resolve, text, type Message, type Model } from "../model";
import { messages as transcript } from "./history";
import type { AgentHooks, AgentHost, AgentPlugin } from "./hooks";

export interface CompressOptions {
  readonly budget?: number;
  readonly limit?: number;
  readonly model?: string | Model;
}

const MEMORY = "memory";
const RESULTS = "results";
const EXPAND = "expand";
const PREVIEW = 2_000;

export function compress(options: CompressOptions = {}): AgentPlugin {
  const budget = options.budget ?? 60_000;
  const limit = options.limit ?? 20_000;
  const memories = new Map<string, Promise<Memory>>();
  return definePlugin<AgentHooks, AgentHost>({
    name: "compress",
    setup(api) {
      const { store } = api.host;
      const model =
        options.model === undefined ? api.host.model : resolve(options.model);
      const load = (owner: string): Promise<Memory> => {
        const known = memories.get(owner);
        if (known !== undefined) return known;
        const loaded = store
          .get(MEMORY, owner)
          .then(
            (bundle) => new Memory(bundle as Bundle<Entity, Fact> | undefined),
          );
        memories.set(owner, loaded);
        return loaded;
      };
      const learn = async (
        owner: string,
        messages: readonly Message[],
        episode: Episode,
        signal?: AbortSignal,
      ) => {
        const memory = await load(owner);
        const { update, usage } = await distill(
          messages,
          memory,
          model,
          signal,
        );
        memory.merge(update, episode);
        await store.put(MEMORY, owner, memory.pack());
        return usage;
      };

      api.hooks.tools.tap({}, (_, tools) => [...tools, expand(store)]);

      api.hooks.context.tap({}, async ({ context }, conversation) => {
        const owner = context.scope.user ?? context.scope.session;
        let messages = conversation.messages;
        const size = approximate(
          JSON.stringify([...conversation.history, ...messages]),
        );
        const cut = size > budget ? boundary(messages) : 0;
        if (cut > 0) {
          const episode = {
            id: context.scope.run,
            time: new Date().toISOString(),
          };
          context.spend(
            await learn(owner, messages.slice(0, cut), episode, context.signal),
          );
          messages = messages.slice(cut);
        }
        const memory = await load(owner);
        const recalled = memory.recall(
          query(messages),
          Math.max(256, Math.floor(budget / 20)),
        );
        if (recalled === "" && cut === 0) return;
        const section = `Memory relevant to this conversation:\n${recalled}`;
        return {
          ...conversation,
          system:
            recalled === ""
              ? conversation.system
              : [conversation.system, section].filter(Boolean).join("\n\n"),
          messages,
        };
      });

      api.hooks.result.tap({}, async ({ tool: operator, context }, output) => {
        if (operator.name === EXPAND) return;
        const content = text(output.result);
        if (content.length <= limit) return;
        const id = `${context.scope.session}/${crypto.randomUUID().slice(0, 8)}`;
        await store.put(RESULTS, id, content);
        return {
          result: `This result has ${content.length} characters, so only the start is shown. Call expand with the id ${id} to read the rest.\n${content.slice(0, PREVIEW)}`,
        };
      });

      api.hooks.end.tap({}, async (run) => {
        if (run.status !== "completed") return;
        const found = transcript(run.output);
        if (found.length === 0) return;
        await learn(run.user ?? run.session, found, {
          id: run.id,
          time: run.updated,
        });
      });
    },
  });
}

function boundary(messages: readonly Message[]): number {
  let cut = Math.floor(messages.length / 2);
  while (cut > 0 && messages[cut]?.role === "tool") cut--;
  return cut;
}

function query(messages: readonly Message[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role === "user") return message.content;
  }
  return "";
}

function expand(store: Store): Operator {
  return tool(
    async (input) => {
      const content = await store.get(RESULTS, String(input["id"]));
      if (typeof content !== "string") {
        throw new Error(`there is no stored result ${String(input["id"])}`);
      }
      const offset = Number(input["offset"] ?? 0);
      const page = content.slice(
        offset,
        offset + Number(input["limit"] ?? 10_000),
      );
      const rest = content.length - offset - page.length;
      return rest > 0
        ? `${page}\n[${rest} more characters; call expand again with offset ${offset + page.length}]`
        : page;
    },
    {
      name: EXPAND,
      description:
        "Read a long tool result that was stored instead of shown, page by page.",
      schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          offset: { type: "integer", minimum: 0 },
          limit: { type: "integer", minimum: 1 },
        },
        required: ["id"],
      },
    },
  );
}

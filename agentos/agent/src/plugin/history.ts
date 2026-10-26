import type { Values } from "@openagent/core";

import { definePlugin } from "@openconsole/plugable";

import type { Message } from "../model";
import type { AgentHooks, AgentHost, AgentPlugin } from "./hooks";

export function history(runs = 3): AgentPlugin {
  const previous = new Map<string, readonly Message[]>();
  return definePlugin<AgentHooks, AgentHost>({
    name: "history",
    setup(api) {
      api.hooks.start.tap({}, async (run) => {
        const done = (await api.host.runs(run.session))
          .filter((item) => item.id !== run.id && item.status === "completed")
          .slice(-runs);
        previous.set(
          run.id,
          done.flatMap((item) => messages(item.output)),
        );
      });
      api.hooks.context.tap({}, ({ context }, conversation) => {
        const found = previous.get(context.scope.run) ?? [];
        if (found.length === 0) return;
        return {
          ...conversation,
          history: [...found, ...conversation.history],
        };
      });
      api.hooks.end.tap({}, (run) => {
        previous.delete(run.id);
      });
    },
  });
}

export function messages(output: Values): readonly Message[] {
  const found = output["messages"];
  return Array.isArray(found) ? (found as Message[]) : [];
}

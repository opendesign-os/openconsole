import type { Context } from "@openagent/core";

import type { Message } from "../model";

export interface Conversation {
  readonly system: string;
  readonly history: readonly Message[];
  readonly messages: readonly Message[];
}

export type Prepare = (
  conversation: Conversation,
  context: Context,
) => Promise<Conversation>;

export function render(conversation: Conversation): Message[] {
  return [
    ...(conversation.system === ""
      ? []
      : [{ role: "system", content: conversation.system } as const]),
    ...conversation.history,
    ...conversation.messages,
  ];
}

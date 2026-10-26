import type { Context, Operator, Run, Store, Values } from "@openagent/core";

import {
  SeriesHook,
  WaterfallHook,
  type Host,
  type Plugin,
} from "@openconsole/plugable";

import type { Model } from "../model";
import type { Conversation } from "../planner";

export interface AgentHost extends Host {
  readonly agent: string;
  readonly model: Model;
  readonly store: Store;
  runs(session: string): Promise<Run[]>;
}

export interface Invocation {
  readonly tool: Operator;
  readonly input: Values;
  readonly context: Context;
}

export interface Permission {
  status: "allow" | "deny";
  input: Values;
  reason?: string | undefined;
}

export function createHooks() {
  return {
    tools: new WaterfallHook<{ readonly agent: string }, Operator[]>("tools"),
    context: new WaterfallHook<{ readonly context: Context }, Conversation>(
      "context",
    ),
    permission: new WaterfallHook<Invocation, Permission>("permission"),
    result: new WaterfallHook<Invocation, { result: unknown }>("result"),
    start: new SeriesHook<Run>("start"),
    end: new SeriesHook<Run>("end"),
  };
}

export type AgentHooks = ReturnType<typeof createHooks>;

export type AgentPlugin<O = unknown> = Plugin<AgentHooks, AgentHost, O>;

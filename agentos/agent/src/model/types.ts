import type { JsonSchema, Usage } from "@openagent/core";

export interface Profile {
  readonly tools: boolean;
  readonly structured: "schema" | "json" | "none";
  readonly reasoning: "send" | "drop";
  readonly limit: "max_tokens" | "max_completion_tokens";
  readonly usage: boolean;
}

export interface Model {
  readonly model: string;
  readonly apiKey: string;
  readonly baseURL: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly timeout?: number;
  readonly retries?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof fetch;
  readonly profile?: Partial<Profile>;
}

export interface Call {
  readonly id: string;
  readonly type: "function";
  readonly function: { readonly name: string; readonly arguments: string };
}

export type Message =
  | { readonly role: "system" | "user"; readonly content: string }
  | {
      readonly role: "assistant";
      readonly content: string | null;
      readonly tool_calls?: readonly Call[];
      readonly reasoning_content?: string;
    }
  | {
      readonly role: "tool";
      readonly tool_call_id: string;
      readonly content: string;
    };

export interface Signature {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
}

export interface Request {
  readonly messages: readonly Message[];
  readonly tools?: readonly Signature[];
  readonly toolChoice?: "auto" | "none";
  readonly responseFormat?: {
    readonly name: string;
    readonly schema: JsonSchema;
  };
  readonly maxTokens?: number;
  readonly temperature?: number;
}

export interface Reply {
  readonly content: string;
  readonly reasoning: string;
  readonly calls: readonly Call[];
  readonly finish: string;
  readonly usage: Usage;
}

export interface Hooks {
  readonly signal?: AbortSignal;
  readonly delta?: (text: string) => void;
}

import type { JsonSchema, Usage } from "../common";

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

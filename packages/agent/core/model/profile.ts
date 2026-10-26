export interface Profile {
  readonly tools: boolean;
  readonly structured: "schema" | "json" | "none";
  readonly reasoning: "send" | "drop";
  readonly limit: "max_tokens" | "max_completion_tokens";
  readonly usage: boolean;
}

export const standard: Profile = {
  tools: true,
  structured: "schema",
  reasoning: "drop",
  limit: "max_tokens",
  usage: true,
};

export interface ChatModel {
  readonly model: string;
  readonly apiKey: string;
  readonly baseURL: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly timeout?: number;
  readonly maxRetries?: number;
  readonly defaultHeaders?: Readonly<Record<string, string>>;
  readonly fetch?: typeof fetch;
  readonly profile?: Partial<Profile>;
}

export const profileOf = (model: ChatModel): Profile => ({
  ...standard,
  ...model.profile,
});

import { RuntimeError } from "@openagent/core";

import type { Model, Profile } from "./types";

export interface Provider {
  readonly baseURL: string;
  readonly key?: string;
  readonly profile?: Partial<Profile>;
}

const providers = new Map<string, Provider>([
  [
    "openai",
    {
      baseURL: "https://api.openai.com/v1",
      key: "OPENAI_API_KEY",
      profile: { limit: "max_completion_tokens" },
    },
  ],
  [
    "deepseek",
    { baseURL: "https://api.deepseek.com/v1", key: "DEEPSEEK_API_KEY" },
  ],
  [
    "qwen",
    {
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      key: "DASHSCOPE_API_KEY",
    },
  ],
  [
    "moonshot",
    { baseURL: "https://api.moonshot.cn/v1", key: "MOONSHOT_API_KEY" },
  ],
  [
    "openrouter",
    { baseURL: "https://openrouter.ai/api/v1", key: "OPENROUTER_API_KEY" },
  ],
  ["ollama", { baseURL: "http://localhost:11434/v1" }],
]);

export function register(name: string, provider: Provider): void {
  providers.set(name, provider);
}

export function resolve(model: string | Model): Model {
  if (typeof model !== "string") return model;
  const colon = model.indexOf(":");
  const provider = colon < 0 ? undefined : providers.get(model.slice(0, colon));
  if (provider === undefined) {
    throw new RuntimeError(
      "model",
      `write the model as provider:name with a registered provider, not ${model}`,
    );
  }
  return {
    model: model.slice(colon + 1),
    baseURL: provider.baseURL,
    apiKey: provider.key === undefined ? "" : (env(provider.key) ?? ""),
    ...(provider.profile === undefined ? {} : { profile: provider.profile }),
  };
}

function env(name: string): string | undefined {
  const scope = globalThis as {
    readonly process?: { readonly env?: Record<string, string | undefined> };
  };
  return scope.process?.env?.[name];
}

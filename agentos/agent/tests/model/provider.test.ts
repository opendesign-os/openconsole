import { afterEach, describe, expect, it, vi } from "vitest";

import { register, resolve } from "../../index";

describe("providers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves provider:model strings with the key from the environment", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-test");
    expect(resolve("deepseek:deepseek-chat")).toMatchObject({
      model: "deepseek-chat",
      baseURL: "https://api.deepseek.com/v1",
      apiKey: "sk-test",
    });
  });

  it("takes registered providers and rejects unknown ones", () => {
    register("local", { baseURL: "http://127.0.0.1:8000/v1" });
    expect(resolve("local:small")).toMatchObject({
      model: "small",
      baseURL: "http://127.0.0.1:8000/v1",
      apiKey: "",
    });
    expect(() => resolve("unknown:x")).toThrow("registered provider");
    expect(() => resolve("no-provider")).toThrow("provider:name");
  });
});

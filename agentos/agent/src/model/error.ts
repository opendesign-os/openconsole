import { RuntimeError } from "@openagent/core";

export class APIError extends RuntimeError {
  public constructor(
    public readonly status: number,
    detail: string,
  ) {
    super("api", `model request failed (${status}): ${detail}`);
  }
}

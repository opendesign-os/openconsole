import type { Operator } from "@openagent/core";

export interface Toolkit {
  readonly name: string;
  readonly instructions?: string;
  readonly tools: readonly Operator[];
}

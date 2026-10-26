import type { Operator } from "@openagent/core";

import type { Model } from "../model";
import type { Prepare } from "./conversation";

export interface Setup {
  readonly name: string;
  readonly model: Model;
  readonly instructions: string;
  readonly tools: readonly Operator[];
  readonly prepare?: Prepare;
}

export type Planner = (setup: Setup) => Operator;

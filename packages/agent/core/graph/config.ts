import type { Values } from "../common";
import type { Status } from "../runtime";

export type StreamMode = "values" | "updates" | "messages" | "custom" | "debug";

export interface RunnableConfig {
  readonly configurable?: {
    readonly thread_id?: string;
    readonly checkpoint_id?: string;
  };
  readonly signal?: AbortSignal;
  readonly recursionLimit?: number;
  readonly tokenLimit?: number;
  readonly maxConcurrency?: number;
}

export interface StreamConfig extends RunnableConfig {
  readonly streamMode?: StreamMode | readonly StreamMode[];
}

export interface Interrupt {
  readonly id: string;
  readonly value: unknown;
}

export type StateValues = Values & {
  readonly __interrupt__?: readonly Interrupt[];
};

export interface StateTask {
  readonly id: string;
  readonly name: string;
  readonly status: Status;
  readonly input?: Values;
  readonly result?: Values;
  readonly error?: string;
  readonly interrupts: readonly Interrupt[];
}

export interface StateSnapshot {
  readonly values: StateValues;
  readonly next: readonly string[];
  readonly tasks: readonly StateTask[];
  readonly config: RunnableConfig;
  readonly parentConfig: RunnableConfig | undefined;
  readonly createdAt: string;
}

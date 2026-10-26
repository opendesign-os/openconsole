import type { Events } from "../engine";
import type { Limits, Usage, Values } from "../graph";

export interface RunOptions {
  readonly session?: string;
  readonly user?: string;
  readonly signal?: AbortSignal;
  readonly limits?: Limits;
}

export interface Pending {
  readonly id: string;
  readonly value: unknown;
}

export interface Run {
  readonly id: string;
  readonly session: string;
  readonly user?: string | undefined;
  readonly status: "running" | "paused" | "completed" | "failed";
  readonly input: Values;
  readonly output: Values;
  readonly pending: readonly Pending[];
  readonly usage: Usage;
  readonly error?: string | undefined;
  readonly created: string;
  readonly updated: string;
}

export interface Resume {
  readonly resume: Readonly<Record<string, unknown>>;
}

export type RunEvent =
  | {
      readonly [K in keyof Events]: { readonly type: K } & Events[K];
    }[keyof Events]
  | { readonly type: "end"; readonly run: Run };

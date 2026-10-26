import { run } from "@openconsole/graph";

import type { Values } from "../common";
import type { FlowGraph } from "../graph";
import { save, Session, type Trace } from "../runtime";

export interface Case {
  readonly input: Values;
  readonly expect?: unknown;
}

export type Scorer = (
  answer: unknown,
  sample: Case,
  trace: Trace,
) => number | Promise<number>;

export interface Bench {
  readonly cases: readonly Case[];
  readonly score: Scorer;
  readonly repeats?: number;
  readonly recursionLimit?: number;
  readonly tokenLimit?: number;
  readonly signal?: AbortSignal;
}

export interface Trial {
  readonly sample: Case;
  readonly answer: unknown;
  readonly score: number;
  readonly tokens: number;
  readonly trace: Trace;
}

export interface Report {
  readonly mean: number;
  readonly deviation: number;
  readonly tokens: number;
  readonly trials: readonly Trial[];
}

export async function evaluate(flow: FlowGraph, bench: Bench): Promise<Report> {
  const trials: Trial[] = [];
  for (let round = 0; round < (bench.repeats ?? 1); round++) {
    for (const sample of bench.cases) {
      const session = new Session(flow.template.copy(), {
        kinds: flow.kinds,
        input: sample.input,
        ...(bench.recursionLimit === undefined
          ? {}
          : { recursionLimit: bench.recursionLimit }),
        ...(bench.tokenLimit === undefined
          ? {}
          : { tokenLimit: bench.tokenLimit }),
        ...(bench.signal === undefined ? {} : { signal: bench.signal }),
      });
      try {
        await run(session);
      } catch (error) {
        if (bench.signal?.aborted === true) throw error;
      }
      const answer = session.values["answer"];
      const trace = save(session);
      trials.push({
        sample,
        answer,
        score: await bench.score(answer, sample, trace),
        tokens: session.spent,
        trace,
      });
    }
  }
  return summarize(trials);
}

export function summarize(trials: readonly Trial[]): Report {
  const count = trials.length;
  if (count === 0) return { mean: 0, deviation: 0, tokens: 0, trials };
  const mean = trials.reduce((sum, trial) => sum + trial.score, 0) / count;
  const variance =
    trials.reduce((sum, trial) => sum + (trial.score - mean) ** 2, 0) / count;
  const tokens = trials.reduce((sum, trial) => sum + trial.tokens, 0) / count;
  return { mean, deviation: Math.sqrt(variance), tokens, trials };
}

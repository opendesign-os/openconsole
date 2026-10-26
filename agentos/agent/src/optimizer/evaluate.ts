import {
  Execution,
  type Limits,
  type State,
  type Values,
  type Weight,
  type Workflow,
} from "@openagent/core";

import { pack, run, type Bundle, type NodeId } from "@openconsole/graph";

export interface Trace {
  readonly graph: Bundle<Weight>;
  readonly states: readonly (readonly [NodeId, State])[];
}

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
  readonly limits?: Limits;
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

export async function evaluate(flow: Workflow, bench: Bench): Promise<Report> {
  const trials: Trial[] = [];
  for (let round = 0; round < (bench.repeats ?? 1); round++) {
    for (const sample of bench.cases) {
      const session = new Execution(flow.template.copy(), {
        operators: flow.operators,
        policy: flow.policy,
        input: sample.input,
        scope: { run: `${flow.name}/${round}`, session: flow.name },
        ...(bench.limits === undefined ? {} : { limits: bench.limits }),
        ...(bench.signal === undefined ? {} : { signal: bench.signal }),
      });
      try {
        await run(session);
      } catch (error) {
        if (bench.signal?.aborted === true) throw error;
      }
      const answer = session.values["answer"];
      const trace: Trace = {
        graph: pack(session.graph),
        states: [...session.states()],
      };
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

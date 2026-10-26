import { Ordering, type EdgeId } from "@openconsole/graph";

import type { FlowGraph } from "../graph";
import { evaluate, type Bench } from "./evaluate";

export interface Draw {
  readonly flow: FlowGraph;
  readonly picks: ReadonlyMap<EdgeId, boolean>;
}

export interface Outcome {
  readonly picks: ReadonlyMap<EdgeId, boolean>;
  readonly score: number;
}

export interface TuneOptions {
  readonly rounds?: number;
  readonly batch?: number;
  readonly rate?: number;
  readonly random?: () => number;
}

const FLOOR = 0.01;

const clamp = (value: number): number =>
  Math.min(1 - FLOOR, Math.max(FLOOR, value));

function chance(weight: unknown): number | undefined {
  if (typeof weight !== "object" || weight === null) return undefined;
  const probability = (weight as { readonly probability?: unknown })
    .probability;
  return typeof probability === "number" ? probability : undefined;
}

export function candidates(flow: FlowGraph): EdgeId[] {
  const template = flow.template;
  return template
    .edges()
    .filter((edge) => chance(template.edgeWeight(edge)) !== undefined);
}

export function sample(
  flow: FlowGraph,
  random: () => number = Math.random,
): Draw {
  const drawn = flow.copy();
  const graph = drawn.template;
  const records = candidates(flow).flatMap((edge) => {
    const record = flow.template.edge(edge);
    return record === undefined ? [] : [record];
  });
  for (const record of records) graph.disconnect(record.id);
  const ordering = new Ordering(graph);
  const picks = new Map<EdgeId, boolean>();
  try {
    for (const record of records) {
      let kept = false;
      if (random() < (chance(record.weight) ?? 0)) {
        try {
          graph.connect(
            [record.source, record.sourcePort],
            [record.target, record.targetPort],
            { id: record.id, weight: record.weight },
          );
          kept = !ordering.conflicts.has(graph.edgeIndexOf(record.id));
          if (!kept) graph.disconnect(record.id);
        } catch {
          kept = false;
        }
      }
      picks.set(record.id, kept);
    }
  } finally {
    ordering.dispose();
  }
  return { flow: drawn, picks };
}

export function reinforce(
  flow: FlowGraph,
  outcomes: readonly Outcome[],
  rate = 0.5,
): void {
  if (outcomes.length === 0) return;
  const template = flow.template;
  const baseline =
    outcomes.reduce((sum, outcome) => sum + outcome.score, 0) / outcomes.length;
  for (const edge of candidates(flow)) {
    const weight = template.edgeWeight(edge);
    const probability = clamp(chance(weight) ?? 0.5);
    let gradient = 0;
    for (const outcome of outcomes) {
      const picked = outcome.picks.get(edge) === true ? 1 : 0;
      gradient += (outcome.score - baseline) * (picked - probability);
    }
    const logit =
      Math.log(probability / (1 - probability)) +
      (rate * gradient) / outcomes.length;
    template.setEdgeWeight(edge, {
      ...(weight as object),
      probability: clamp(1 / (1 + Math.exp(-logit))),
    });
  }
}

export async function tune(
  flow: FlowGraph,
  bench: Bench,
  options: TuneOptions = {},
): Promise<number[]> {
  const history: number[] = [];
  for (let round = 0; round < (options.rounds ?? 5); round++) {
    const outcomes: Outcome[] = [];
    for (let index = 0; index < (options.batch ?? 4); index++) {
      const draw = sample(flow, options.random);
      const report = await evaluate(draw.flow, bench);
      outcomes.push({ picks: draw.picks, score: report.mean });
    }
    reinforce(flow, outcomes, options.rate);
    history.push(
      outcomes.reduce((sum, outcome) => sum + outcome.score, 0) /
        outcomes.length,
    );
  }
  return history;
}

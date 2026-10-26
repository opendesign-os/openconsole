import { diff, type Change } from "@openconsole/graph";

import {
  check,
  extract,
  properties,
  ValidationError,
  type JsonSchema,
  type Weight,
} from "../common";
import { FlowGraph } from "../graph";
import { complete, type ChatModel, type Message } from "../model";
import type { Outline } from "../runtime";
import { evaluate, type Bench, type Report } from "./evaluate";

export interface Lesson {
  readonly changes: readonly Change<Weight, unknown>[];
  readonly before: number;
  readonly after: number;
}

export interface Variant {
  readonly id: number;
  readonly flow: FlowGraph;
  readonly parent: number | undefined;
  readonly changes: readonly Change<Weight, unknown>[];
  readonly report: Report;
  readonly lessons: Lesson[];
}

export type Proposer = (
  variant: Variant,
  signal?: AbortSignal,
) => Promise<FlowGraph>;

export interface SearchOptions {
  readonly rounds?: number;
  readonly top?: number;
  readonly patience?: number;
  readonly mix?: number;
  readonly heat?: number;
  readonly random?: () => number;
}

const OUTLINE: JsonSchema = {
  type: "object",
  required: ["nodes", "edges"],
  properties: {
    nodes: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "kind"],
        properties: {
          id: { type: "string" },
          kind: { type: "string" },
          values: { type: "object" },
          parent: { type: "string" },
        },
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        required: ["from", "to"],
        properties: {
          from: {
            type: "array",
            items: { type: "string" },
            minItems: 2,
            maxItems: 2,
          },
          to: {
            type: "array",
            items: { type: "string" },
            minItems: 2,
            maxItems: 2,
          },
        },
      },
    },
  },
};

export async function search(
  flow: FlowGraph,
  bench: Bench,
  propose: Proposer,
  options: SearchOptions = {},
): Promise<Variant[]> {
  const rounds = options.rounds ?? 20;
  const top = options.top ?? 3;
  const patience = options.patience ?? 5;
  const root: Variant = {
    id: 0,
    flow,
    parent: undefined,
    changes: [],
    report: await evaluate(flow, bench),
    lessons: [],
  };
  const variants: Variant[] = [root];
  let best = leading(variants, top);
  let stale = 0;
  for (let round = 1; round <= rounds && stale < patience; round++) {
    const parent = pick(root, variants, top, options);
    let child: FlowGraph;
    try {
      child = await propose(parent, bench.signal);
    } catch (error) {
      if (bench.signal?.aborted === true) throw error;
      stale++;
      continue;
    }
    const changes = diff(parent.flow.template, child.template);
    if (changes.length === 0) {
      stale++;
      continue;
    }
    const report = await evaluate(child, bench);
    parent.lessons.push({
      changes,
      before: parent.report.mean,
      after: report.mean,
    });
    variants.push({
      id: variants.length,
      flow: child,
      parent: parent.id,
      changes,
      report,
      lessons: [],
    });
    const average = leading(variants, top);
    if (average > best) {
      best = average;
      stale = 0;
    } else {
      stale++;
    }
  }
  return [...variants].sort((a, b) => b.report.mean - a.report.mean);
}

function leaders(variants: readonly Variant[], top: number): Variant[] {
  return [...variants]
    .sort((a, b) => b.report.mean - a.report.mean)
    .slice(0, top);
}

function leading(variants: readonly Variant[], top: number): number {
  const chosen = leaders(variants, top);
  return (
    chosen.reduce((sum, variant) => sum + variant.report.mean, 0) /
    chosen.length
  );
}

function pick(
  root: Variant,
  variants: readonly Variant[],
  top: number,
  options: SearchOptions,
): Variant {
  const chosen = leaders(variants, top);
  const pool = chosen.includes(root) ? chosen : [...chosen, root];
  const mix = options.mix ?? 0.2;
  const heat = options.heat ?? 5;
  const peak = Math.max(...pool.map((variant) => variant.report.mean));
  const scaled = pool.map((variant) =>
    Math.exp(heat * (variant.report.mean - peak)),
  );
  const total = scaled.reduce((sum, value) => sum + value, 0);
  let roll = (options.random ?? Math.random)();
  for (const [index, variant] of pool.entries()) {
    roll -= mix / pool.length + ((1 - mix) * (scaled[index] ?? 0)) / total;
    if (roll <= 0) return variant;
  }
  return pool.at(-1) ?? root;
}

export function describe(change: Change<Weight, unknown>): string {
  switch (change.kind) {
    case "addNode":
      return `add node ${change.node.id} (${change.node.weight?.kind ?? "?"})`;
    case "dropNode":
      return `drop node ${change.node.id}`;
    case "addEdge":
      return `add edge ${change.edge.source}.${change.edge.sourcePort} -> ${change.edge.target}.${change.edge.targetPort}`;
    case "dropEdge":
      return `drop edge ${change.edge.source}.${change.edge.sourcePort} -> ${change.edge.target}.${change.edge.targetPort}`;
    case "weighNode":
      return `change the input of ${change.node}`;
    case "weighEdge":
      return `change the weight of edge ${change.edge}`;
    case "reparent":
      return `move ${change.node} under ${change.to ?? "the root"}`;
  }
}

export function proposer(model: ChatModel): Proposer {
  return async (variant, signal) => {
    const catalog = [...variant.flow.kinds.values()].map((kind) => ({
      name: kind.name,
      description: kind.description,
      inputs: Object.keys(properties(kind.inputSchema)),
      outputs: Object.keys(properties(kind.outputSchema)),
    }));
    const messages: Message[] = [
      {
        role: "system",
        content:
          'You improve an agent workflow graph. Make exactly one modification: add or remove a node, change the input values of a node, or rewire an edge. Use only the listed kinds and their port names. Reply with the complete modified workflow as a JSON object {"nodes": [...], "edges": [...]} in the same shape as the input.',
      },
      {
        role: "user",
        content: JSON.stringify({
          workflow: variant.flow.toJSON(),
          score: variant.report.mean,
          kinds: catalog,
          lessons: variant.lessons.map((lesson) => ({
            changes: lesson.changes.map(describe),
            before: lesson.before,
            after: lesson.after,
          })),
        }),
      },
    ];
    const reply = await complete(
      model,
      { messages, responseFormat: { name: "workflow", schema: OUTLINE } },
      signal === undefined ? {} : { signal },
    );
    const parsed = extract(reply.content);
    const problems =
      parsed === undefined
        ? ["the reply is not a JSON object"]
        : check(OUTLINE, parsed);
    if (parsed === undefined || problems.length > 0) {
      throw new ValidationError("proposal", problems);
    }
    return FlowGraph.from(
      parsed as unknown as Outline,
      variant.flow.kinds.values(),
    );
  };
}

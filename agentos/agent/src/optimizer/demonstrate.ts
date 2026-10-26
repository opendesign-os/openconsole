import { type JsonSchema, type Values } from "@openagent/core";

import { unpack } from "@openconsole/graph";

import { complete, extract, type Message, type Model } from "../model";
import type { Example, Prompt } from "../model";
import type { Report } from "./evaluate";

export interface Occurrence {
  readonly input: Values;
  readonly output: Values | undefined;
  readonly error: string | undefined;
  readonly score: number;
}

export interface DemonstrateOptions {
  readonly limit?: number;
  readonly threshold?: number;
}

const INSTRUCTION: JsonSchema = {
  type: "object",
  properties: { systemPrompt: { type: "string" } },
  required: ["systemPrompt"],
};

export function occurrences(report: Report, operator: string): Occurrence[] {
  const found: Occurrence[] = [];
  for (const trial of report.trials) {
    const graph = unpack(trial.trace.graph);
    for (const [node, state] of trial.trace.states) {
      if (
        graph.nodeWeight(node)?.operator !== operator ||
        state.input === undefined
      ) {
        continue;
      }
      if (state.status !== "done" && state.status !== "failed") continue;
      found.push({
        input: state.input,
        output: state.outputs,
        error: state.error,
        score: trial.score,
      });
    }
  }
  return found;
}

export function demonstrate(
  spec: Prompt,
  report: Report,
  options: DemonstrateOptions = {},
): Prompt {
  const limit = options.limit ?? 4;
  const threshold = options.threshold ?? 1;
  const seen = new Set<string>();
  const examples: Example[] = [];
  const ranked = occurrences(report, spec.name)
    .filter((occurrence) => occurrence.score >= threshold)
    .sort((a, b) => b.score - a.score);
  for (const occurrence of ranked) {
    if (examples.length >= limit) break;
    const key = JSON.stringify(occurrence.input);
    if (occurrence.output === undefined || seen.has(key)) continue;
    seen.add(key);
    examples.push({ input: occurrence.input, output: occurrence.output });
  }
  return examples.length === 0 ? spec : { ...spec, examples };
}

export async function refine(
  spec: Prompt,
  report: Report,
  model: Model,
  signal?: AbortSignal,
): Promise<Prompt> {
  const ranked = occurrences(report, spec.name).sort(
    (a, b) => b.score - a.score,
  );
  const history =
    ranked.length <= 6 ? ranked : [...ranked.slice(0, 3), ...ranked.slice(-3)];
  const messages: Message[] = [
    {
      role: "system",
      content:
        'You improve the system prompt of one step in an agent workflow from its execution history: what it received, what it produced, and how the whole run scored. Reply with a JSON object {"systemPrompt": "..."}.',
    },
    {
      role: "user",
      content: JSON.stringify({
        name: spec.name,
        description: spec.description,
        systemPrompt: spec.systemPrompt,
        outputSchema: spec.outputSchema,
        history,
      }),
    },
  ];
  const reply = await complete(
    model,
    { messages, responseFormat: { name: "instruction", schema: INSTRUCTION } },
    signal === undefined ? {} : { signal },
  );
  const systemPrompt = extract(reply.content)?.["systemPrompt"];
  return typeof systemPrompt === "string" && systemPrompt.trim() !== ""
    ? { ...spec, systemPrompt }
    : spec;
}

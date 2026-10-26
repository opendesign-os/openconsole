import { check, extract, ValidationError, type JsonSchema } from "../common";
import { FlowGraph } from "../graph";
import { complete, type ChatModel, type Message } from "../model";
import { prompt, type Prompt } from "../node";
import { evaluate, type Bench, type Report } from "./evaluate";

export interface Entry {
  readonly spec: Prompt;
  readonly report: Report;
  readonly generation: number;
}

export type Place = (spec: Prompt) => FlowGraph;

export interface ExploreOptions {
  readonly meta: ChatModel;
  readonly worker: ChatModel;
  readonly place?: Place;
  readonly rounds?: number;
  readonly reflections?: number;
}

const DESIGN: JsonSchema = {
  type: "object",
  required: [
    "name",
    "description",
    "systemPrompt",
    "inputSchema",
    "outputSchema",
  ],
  properties: {
    name: { type: "string", pattern: "^[A-Za-z0-9_-]{1,64}$" },
    description: { type: "string" },
    systemPrompt: { type: "string" },
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
  },
};

export async function explore(
  seeds: readonly Prompt[],
  bench: Bench,
  options: ExploreOptions,
): Promise<Entry[]> {
  const place =
    options.place ??
    ((spec: Prompt) =>
      new FlowGraph().addNode(spec.name, prompt(spec, options.worker)));
  const archive: Entry[] = [];
  for (const spec of seeds) {
    archive.push({
      spec,
      report: await evaluate(place(spec), bench),
      generation: 0,
    });
  }
  for (let generation = 1; generation <= (options.rounds ?? 25); generation++) {
    let spec: Prompt;
    try {
      spec = await design(options.meta, archive, bench.signal);
      for (let index = 0; index < (options.reflections ?? 2); index++) {
        spec = await reflect(options.meta, archive, spec, bench.signal);
      }
    } catch (error) {
      if (bench.signal?.aborted === true) throw error;
      continue;
    }
    const name = spec.name;
    if (archive.some((entry) => entry.spec.name === name)) continue;
    try {
      archive.push({
        spec,
        report: await evaluate(place(spec), bench),
        generation,
      });
    } catch (error) {
      if (bench.signal?.aborted === true) throw error;
    }
  }
  return archive.sort((a, b) => b.report.mean - a.report.mean);
}

function summary(archive: readonly Entry[]): unknown[] {
  return archive.map((entry) => ({
    name: entry.spec.name,
    description: entry.spec.description,
    systemPrompt: entry.spec.systemPrompt,
    inputSchema: entry.spec.inputSchema,
    outputSchema: entry.spec.outputSchema,
    score: entry.report.mean,
    generation: entry.generation,
  }));
}

function design(
  meta: ChatModel,
  archive: readonly Entry[],
  signal: AbortSignal | undefined,
): Promise<Prompt> {
  return ask(
    meta,
    [
      {
        role: "system",
        content:
          'You design steps for an agent. A step is a prompt with typed inputs and outputs. Study the archive of earlier designs and their scores, then propose one new design that is novel and likely to score higher. Its output schema must include an "answer" property, which is what gets scored. Reply with a JSON object {"name", "description", "systemPrompt", "inputSchema", "outputSchema"}, where the schemas are JSON Schemas of type object.',
      },
      { role: "user", content: JSON.stringify(summary(archive)) },
    ],
    signal,
  );
}

function reflect(
  meta: ChatModel,
  archive: readonly Entry[],
  spec: Prompt,
  signal: AbortSignal | undefined,
): Promise<Prompt> {
  return ask(
    meta,
    [
      {
        role: "system",
        content:
          'Review a proposed agent step. Check that it is novel compared with the archive and free of mistakes: valid JSON Schemas, a system prompt consistent with them, and an "answer" output. Reply with the revised design as the same JSON object.',
      },
      {
        role: "user",
        content: JSON.stringify({ archive: summary(archive), proposal: spec }),
      },
    ],
    signal,
  );
}

async function ask(
  meta: ChatModel,
  messages: readonly Message[],
  signal: AbortSignal | undefined,
): Promise<Prompt> {
  const reply = await complete(
    meta,
    { messages, responseFormat: { name: "design", schema: DESIGN } },
    signal === undefined ? {} : { signal },
  );
  const parsed = extract(reply.content);
  const problems =
    parsed === undefined
      ? ["the reply is not a JSON object"]
      : check(DESIGN, parsed);
  if (parsed === undefined || problems.length > 0) {
    throw new ValidationError("design", problems);
  }
  return parsed as unknown as Prompt;
}

import {
  fault,
  LimitError,
  properties,
  successor,
  type Context,
  type Edge,
  type JsonSchema,
  type Operator,
  type Values,
} from "@openagent/core";

import { nodeId, type NodeId } from "@openconsole/graph";

import { complete, extract, text } from "../model";
import { render, type Conversation } from "./conversation";
import type { Planner, Setup } from "./types";

export interface CompilerOptions {
  readonly rounds?: number;
}

interface Planned {
  readonly number: number;
  readonly node: NodeId;
  readonly operator: Operator;
  readonly line: string;
}

const REFERENCE = /^\$(\d+)(?:\.([A-Za-z_][\w-]*))?$/;

const DECISION: JsonSchema = {
  type: "object",
  properties: { answer: { type: "string" }, replan: { type: "string" } },
};

export function compiler(options: CompilerOptions = {}): Planner {
  return (setup) => build(setup, options.rounds ?? 3)[0];
}

function build(setup: Setup, rounds: number): readonly [Operator, Operator] {
  const { name, model, prepare } = setup;
  const joiner = `${name}_join`;
  const tools = new Map(
    setup.tools.map((operator) => [operator.name, operator]),
  );
  const guide = protocol(setup);

  const planner: Operator = {
    name,
    description:
      "Plans a dependency graph of tool calls in one reply and streams it into the run.",
    plans: true,
    get uses() {
      return [...setup.tools, join];
    },
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string" },
        messages: { type: "array" },
        feedback: { type: "string" },
        round: { type: "integer" },
      },
    },
    outputSchema: { type: "object", properties: { plan: { type: "string" } } },
    run: async (input, context) => {
      const task = request(input);
      const round = typeof input["round"] === "number" ? input["round"] : 1;
      const feedback =
        typeof input["feedback"] === "string"
          ? `\n\nFeedback from the previous round:\n${input["feedback"]}`
          : "";
      const planned: Planned[] = [];
      let buffer = "";
      const take = (line: string): void => {
        const trimmed = line.trim();
        if (trimmed.startsWith("{")) {
          planned.push(admit(trimmed, planned, tools, context));
        }
      };
      const opening: Conversation = {
        system: guide,
        history: [],
        messages: [{ role: "user", content: `${task}${feedback}` }],
      };
      const prepared =
        prepare === undefined ? opening : await prepare(opening, context);
      const reply = await complete(
        model,
        { messages: render(prepared) },
        {
          signal: context.signal,
          delta: (chunk) => {
            context.emit(chunk);
            buffer += chunk;
            for (
              let end = buffer.indexOf("\n");
              end >= 0;
              end = buffer.indexOf("\n")
            ) {
              take(buffer.slice(0, end));
              buffer = buffer.slice(end + 1);
            }
          },
        },
      );
      take(buffer);
      context.spend(reply.usage);
      const join = nodeId(`${context.node}/join`);
      context.grow({
        steps: [
          {
            id: join,
            operator: joiner,
            values: {
              task,
              round,
              origin: context.node,
              tasks: planned.map((item) => ({
                id: item.number,
                tool: item.operator.name,
                line: item.line,
              })),
            },
            parent: context.parent ?? null,
          },
        ],
        edges: planned.map(
          (item): Edge => ({
            from: [item.node, primary(item.operator)],
            to: [join, "results"],
          }),
        ),
      });
      return { plan: reply.content };
    },
  };

  const join: Operator = {
    name: joiner,
    description:
      "Decides whether the results answer the task or another planning round is needed.",
    plans: true,
    get uses() {
      return [planner];
    },
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string" },
        round: { type: "integer" },
        origin: { type: "string" },
        tasks: { type: "array" },
        results: { type: "array" },
      },
    },
    outputSchema: DECISION,
    run: async (input, context) => {
      const round = typeof input["round"] === "number" ? input["round"] : 1;
      const final = round >= rounds;
      const tasks = Array.isArray(input["tasks"]) ? input["tasks"] : [];
      const results = Array.isArray(input["results"]) ? input["results"] : [];
      const outcome = tasks.map((task: unknown, index) => ({
        task,
        result: results[index],
      }));
      const instruction = final
        ? 'Answer the task from the results. Reply with a JSON object {"answer": "..."}.'
        : 'Decide whether the results answer the task. Reply with a JSON object: {"answer": "..."} when they do, or {"replan": "what the next round should do differently"} when more tool calls are needed.';
      const reply = await complete(
        model,
        {
          messages: [
            { role: "system", content: instruction },
            {
              role: "user",
              content: JSON.stringify({
                task: input["task"],
                results: outcome,
              }),
            },
          ],
          responseFormat: { name: "decision", schema: DECISION },
        },
        { signal: context.signal, delta: context.emit },
      );
      context.spend(reply.usage);
      const decision = extract(reply.content);
      const replan = decision?.["replan"];
      if (!final && typeof replan === "string" && replan.trim() !== "") {
        const origin =
          typeof input["origin"] === "string"
            ? nodeId(input["origin"])
            : context.node;
        context.grow({
          steps: [
            {
              id: successor(origin, round + 1),
              operator: name,
              values: {
                task: text(input["task"]),
                round: round + 1,
                feedback: `${replan}\n\nResults so far:\n${JSON.stringify(outcome)}`,
              },
              parent: context.parent ?? null,
            },
          ],
        });
        return { replan };
      }
      const answer = decision?.["answer"];
      return { answer: typeof answer === "string" ? answer : reply.content };
    },
  };

  return [planner, join];
}

function request(input: Values): string {
  if (typeof input["task"] === "string") return input["task"];
  const messages = Array.isArray(input["messages"]) ? input["messages"] : [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index] as { role?: unknown; content?: unknown };
    if (message.role === "user") return text(message.content);
  }
  return "";
}

function admit(
  line: string,
  planned: readonly Planned[],
  tools: ReadonlyMap<string, Operator>,
  context: Context,
): Planned {
  const position = planned.length + 1;
  const node = nodeId(`${context.node}/${position}`);
  const parsed = extract(line);
  const id = parsed?.["id"];
  const number = typeof id === "number" ? id : position;
  const failure = (error: string): Planned => {
    context.grow({
      steps: [{ id: node, operator: fault.name, values: { error } }],
    });
    return { number, node, operator: fault, line };
  };
  if (parsed === undefined)
    return failure(`line ${position} is not a JSON object`);
  if (planned.some((item) => item.number === number)) {
    return failure(`task id ${number} is used twice`);
  }
  const operator = tools.get(text(parsed["tool"]));
  if (operator === undefined)
    return failure(`unknown tool ${text(parsed["tool"])}`);
  const values: Record<string, unknown> = {};
  const edges: Edge[] = [];
  const args = parsed["args"];
  if (typeof args === "object" && args !== null && !Array.isArray(args)) {
    for (const [key, value] of Object.entries(args)) {
      const match = typeof value === "string" ? REFERENCE.exec(value) : null;
      if (match === null) {
        values[key] = value;
        continue;
      }
      const source = planned.find((item) => item.number === Number(match[1]));
      if (source === undefined) {
        return failure(`task ${number} refers to an unknown task ${value}`);
      }
      edges.push({
        from: [source.node, match[2] ?? primary(source.operator)],
        to: [node, key],
      });
    }
  }
  try {
    context.grow({
      steps: [{ id: node, operator: operator.name, values }],
      edges,
    });
  } catch (error) {
    if (error instanceof LimitError) throw error;
    return failure(error instanceof Error ? error.message : String(error));
  }
  return { number, node, operator, line };
}

function primary(operator: Operator): string {
  const names = Object.keys(properties(operator.outputSchema));
  return names.includes("result") ? "result" : (names[0] ?? "result");
}

function protocol(setup: Setup): string {
  const catalog = setup.tools.map(
    (operator) =>
      `- ${operator.name}: ${operator.description}\n  args schema: ${JSON.stringify(operator.inputSchema)}`,
  );
  return [
    "Plan the tool calls that solve the task. Write one task per line as a JSON object, and nothing else:",
    '{"id": 1, "tool": "<tool>", "args": {...}}',
    'Number the tasks from 1. To pass the output of an earlier task as an argument, write the whole argument value as "$<id>", or "$<id>.<output>" for a named output.',
    "Tasks that do not refer to each other run in parallel; a task starts as soon as the tasks it refers to have finished.",
    "",
    "Tools:",
    ...catalog,
    ...(setup.instructions === "" ? [] : ["", setup.instructions]),
  ].join("\n");
}

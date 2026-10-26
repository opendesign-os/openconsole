import { check, type JsonSchema, type Usage } from "@openagent/core";

import { complete, extract, type Message, type Model } from "../model";
import type { Memory, Update } from "./graph";

const TRIPLE = {
  subject: { type: "string" },
  relation: { type: "string" },
  object: { type: "string" },
};

const UPDATE: JsonSchema = {
  type: "object",
  properties: {
    entities: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, summary: { type: "string" } },
        required: ["name", "summary"],
      },
    },
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: { ...TRIPLE, statement: { type: "string" } },
        required: ["subject", "relation", "object", "statement"],
      },
    },
    expired: {
      type: "array",
      items: {
        type: "object",
        properties: TRIPLE,
        required: ["subject", "relation", "object"],
      },
    },
  },
  required: ["entities", "facts", "expired"],
};

const INSTRUCTION = `Turn the conversation into memory: a knowledge graph of entities and facts that later work will need.
- entities: people, files, projects, tools, concepts and decisions, each with a one-sentence summary.
- facts: relations between two entities, each with subject, relation (a short snake_case verb phrase), object and a full-sentence statement. Keep goals, decisions, preferences, results and open questions.
- expired: facts from the existing memory that the conversation shows are no longer true.
Reuse the exact names of existing entities when they mean the same thing. Skip small talk.`;

const CHARS = 2_000;

export async function distill(
  messages: readonly Message[],
  memory: Memory,
  model: Model,
  signal?: AbortSignal,
): Promise<{ readonly update: Update; readonly usage: Usage }> {
  const transcript = render(messages);
  const known = memory.recall(transcript, 1_000);
  const reply = await complete(
    model,
    {
      messages: [
        { role: "system", content: INSTRUCTION },
        {
          role: "user",
          content: `${known === "" ? "" : `Existing memory:\n${known}\n\n`}Conversation:\n${transcript}`,
        },
      ],
      responseFormat: { name: "memory", schema: UPDATE },
    },
    signal === undefined ? {} : { signal },
  );
  const parsed = extract(reply.content);
  const update =
    parsed !== undefined && check(UPDATE, parsed).length === 0
      ? (parsed as Update)
      : {};
  return { update, usage: reply.usage };
}

function render(messages: readonly Message[]): string {
  return messages
    .map((message) => {
      const calls =
        message.role === "assistant"
          ? (message.tool_calls ?? [])
              .map(
                (call) =>
                  ` [${call.function.name}(${call.function.arguments})]`,
              )
              .join("")
          : "";
      const content = message.content ?? "";
      const clipped =
        content.length > CHARS ? `${content.slice(0, CHARS)}…` : content;
      return `${message.role}: ${clipped}${calls}`;
    })
    .join("\n\n");
}

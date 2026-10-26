import {
  fault,
  successor,
  type Edge,
  type Operator,
  type Step,
  type Values,
} from "@openagent/core";

import { nodeId, type NodeId } from "@openconsole/graph";

import {
  complete,
  text,
  type Call,
  type Message,
  type Signature,
} from "../model";
import { render, type Conversation } from "./conversation";
import type { Planner, Setup } from "./types";

export function loop(): Planner {
  return build;
}

function build(setup: Setup): Operator {
  const { name, model, prepare } = setup;
  const tools = new Set(setup.tools.map((operator) => operator.name));
  const signatures = setup.tools.map(
    (operator): Signature => ({
      name: operator.name,
      description: operator.description,
      parameters: operator.inputSchema,
    }),
  );
  return {
    name,
    description:
      "Plans with native tool calls: every reply is a node and every call a tool node.",
    plans: true,
    uses: setup.tools,
    inputSchema: {
      type: "object",
      properties: {
        messages: { type: "array" },
        task: { type: "string" },
        results: { type: "array" },
        turn: { type: "integer" },
      },
    },
    outputSchema: {
      type: "object",
      properties: { messages: { type: "array" }, answer: { type: "string" } },
    },
    run: async (input, context) => {
      const turn = typeof input["turn"] === "number" ? input["turn"] : 0;
      const final = context.remaining < 2;
      const messages = history(input);
      const opening: Conversation = {
        system: messages[0]?.role === "system" ? "" : setup.instructions,
        history: [],
        messages,
      };
      const prepared =
        prepare === undefined ? opening : await prepare(opening, context);
      const reply = await complete(
        model,
        {
          messages: render(prepared),
          tools: signatures,
          toolChoice: final ? "none" : "auto",
        },
        { signal: context.signal, delta: context.emit },
      );
      context.spend(reply.usage);
      const calls = final ? [] : reply.calls;
      const message: Message = {
        role: "assistant",
        content: reply.content === "" ? null : reply.content,
        ...(calls.length === 0 ? {} : { tool_calls: calls }),
        ...(reply.reasoning === ""
          ? {}
          : { reasoning_content: reply.reasoning }),
      };
      const transcript = [...prepared.messages, message];
      if (calls.length === 0) {
        return { messages: transcript, answer: reply.content };
      }
      if (reply.finish === "length") {
        throw new Error("the reply was cut off while calling tools");
      }
      const steps = calls.map((call, index) =>
        step(tools, call, nodeId(`${context.node}/${index + 1}`)),
      );
      const next = successor(context.node, turn + 1);
      context.grow({
        steps: [
          ...steps,
          {
            id: next,
            operator: name,
            values: { turn: turn + 1 },
            parent: context.parent ?? null,
          },
        ],
        edges: [
          { from: [context.node, "messages"], to: [next, "messages"] },
          ...steps.map(
            (item): Edge => ({
              from: [item.id, "result"],
              to: [next, "results"],
            }),
          ),
        ],
      });
      return { messages: transcript };
    },
  };
}

function history(input: Values): Message[] {
  const messages = Array.isArray(input["messages"])
    ? (input["messages"] as Message[])
    : [];
  const last = messages.at(-1);
  if (last?.role === "assistant" && last.tool_calls !== undefined) {
    const results = Array.isArray(input["results"]) ? input["results"] : [];
    return [
      ...messages,
      ...last.tool_calls.map(
        (call, index): Message => ({
          role: "tool",
          tool_call_id: call.id,
          content: text(results[index]),
        }),
      ),
    ];
  }
  if (messages.length > 0) return [...messages];
  const task = input["task"];
  return typeof task === "string" ? [{ role: "user", content: task }] : [];
}

function step(tools: ReadonlySet<string>, call: Call, id: NodeId): Step {
  const name = call.function.name;
  const failure = (error: string): Step => ({
    id,
    operator: fault.name,
    values: { error },
  });
  if (!tools.has(name)) return failure(`unknown tool ${name}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      call.function.arguments === "" ? "{}" : call.function.arguments,
    );
  } catch {
    return failure(`arguments of ${name} are not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return failure(`arguments of ${name} must be a JSON object`);
  }
  return { id, operator: name, values: parsed as Values };
}

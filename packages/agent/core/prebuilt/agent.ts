import type { Kind } from "../common";
import { FlowGraph, type Checkpointer, type CompiledFlowGraph } from "../graph";
import type { ChatModel } from "../model";
import { loop } from "../planner";

export interface CreateAgentParams {
  readonly model: ChatModel;
  readonly tools: readonly Kind[];
  readonly systemPrompt?: string;
  readonly checkpointer?: Checkpointer;
  readonly interruptBefore?: readonly string[];
  readonly interruptAfter?: readonly string[];
  readonly name?: string;
}

export function createAgent(params: CreateAgentParams): CompiledFlowGraph {
  const name = params.name ?? "agent";
  const planner = loop(
    {
      name,
      tools: params.tools,
      ...(params.systemPrompt === undefined
        ? {}
        : { systemPrompt: params.systemPrompt }),
    },
    params.model,
  );
  return new FlowGraph().addNode(name, planner).compile({
    name,
    ...(params.checkpointer === undefined
      ? {}
      : { checkpointer: params.checkpointer }),
    ...(params.interruptBefore === undefined
      ? {}
      : { interruptBefore: params.interruptBefore }),
    ...(params.interruptAfter === undefined
      ? {}
      : { interruptAfter: params.interruptAfter }),
  });
}

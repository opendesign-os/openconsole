import { FlowGraph, type CompiledFlowGraph } from "../graph";
import { compiler } from "../planner";
import type { CreateAgentParams } from "./agent";

export interface CreateCompilerAgentParams extends CreateAgentParams {
  readonly maxRounds?: number;
}

export function createCompilerAgent(
  params: CreateCompilerAgentParams,
): CompiledFlowGraph {
  const name = params.name ?? "compiler";
  const [planner] = compiler(
    {
      name,
      tools: params.tools,
      ...(params.systemPrompt === undefined
        ? {}
        : { systemPrompt: params.systemPrompt }),
      ...(params.maxRounds === undefined
        ? {}
        : { maxRounds: params.maxRounds }),
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

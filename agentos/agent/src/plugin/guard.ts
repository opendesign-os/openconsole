import { check, ValidationError, type Operator } from "@openagent/core";

import type { AgentHooks } from "./hooks";

export function guard(tool: Operator, hooks: AgentHooks): Operator {
  return {
    ...tool,
    run: async (input, context) => {
      const permission = await hooks.permission.call(
        { tool, input, context },
        { status: "allow", input },
      );
      if (permission.status === "deny") {
        const reason =
          permission.reason === undefined ? "." : `: ${permission.reason}`;
        return { result: `The call to ${tool.name} was denied${reason}` };
      }
      if (permission.input !== input) {
        const problems = check(tool.inputSchema, permission.input);
        if (problems.length > 0) {
          throw new ValidationError(`input of ${context.node}`, problems);
        }
      }
      const outputs = await tool.run(permission.input, context);
      if (!("result" in outputs)) return outputs;
      const { result } = await hooks.result.call(
        { tool, input: permission.input, context },
        { result: outputs["result"] },
      );
      return { ...outputs, result };
    },
  };
}

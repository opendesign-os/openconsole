import {
  check,
  ValidationError,
  type Operator,
  type Values,
} from "@openagent/core";

export type Decision =
  | { readonly type: "approve" }
  | { readonly type: "edit"; readonly input: Values }
  | { readonly type: "reject"; readonly reason?: string };

export function confirm(tool: Operator): Operator {
  return {
    ...tool,
    run: async (input, context) => {
      const decision = context.interrupt({ tool: tool.name, input });
      if (!decides(decision)) {
        throw new Error(
          'resume with { type: "approve" }, { type: "edit", input } or { type: "reject", reason }',
        );
      }
      if (decision.type === "reject") {
        const reason =
          decision.reason === undefined ? "." : `: ${decision.reason}`;
        return { result: `The call to ${tool.name} was rejected${reason}` };
      }
      if (decision.type === "approve") return tool.run(input, context);
      const problems = check(tool.inputSchema, decision.input);
      if (problems.length > 0) {
        throw new ValidationError(`edited input of ${context.node}`, problems);
      }
      return tool.run(decision.input, context);
    },
  };
}

function decides(value: unknown): value is Decision {
  if (typeof value !== "object" || value === null) return false;
  const decision = value as {
    readonly type?: unknown;
    readonly input?: unknown;
  };
  if (decision.type === "approve" || decision.type === "reject") return true;
  return (
    decision.type === "edit" &&
    typeof decision.input === "object" &&
    decision.input !== null
  );
}

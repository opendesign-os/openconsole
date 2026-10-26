import type { Context, Operator, ToolFields } from "./operator";
import type { Values } from "./schema";

export function tool(
  func: (input: Values, context: Context) => unknown,
  fields: ToolFields,
): Operator {
  return {
    name: fields.name,
    description: fields.description,
    inputSchema: fields.schema ?? { type: "object", properties: {} },
    outputSchema: { type: "object", properties: { result: {} } },
    ...(fields.policy === undefined ? {} : { policy: fields.policy }),
    run: async (input, context) => ({
      result: (await func(input, context)) ?? null,
    }),
  };
}

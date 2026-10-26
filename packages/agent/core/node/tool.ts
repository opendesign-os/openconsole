import type { Context, Kind, ToolFields, Values } from "../common";

export function tool(
  func: (input: Values, context: Context) => unknown,
  fields: ToolFields,
): Kind {
  return {
    name: fields.name,
    description: fields.description,
    inputSchema: fields.schema ?? { type: "object", properties: {} },
    outputSchema: { type: "object", properties: { result: {} } },
    run: async (input, context) => ({
      result: (await func(input, context)) ?? null,
    }),
  };
}

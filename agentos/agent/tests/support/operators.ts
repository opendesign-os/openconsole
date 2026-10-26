import { tool, type JsonSchema, type Operator } from "@openagent/core";

import { nodeId, type NodeId } from "@openconsole/graph";

export const id = (value: string): NodeId => nodeId(value);

const numeric: JsonSchema = {
  type: "object",
  properties: { value: { type: "number" } },
  required: ["value"],
};

export const number: Operator = tool((input) => input["value"], {
  name: "number",
  description: "Returns its value.",
  schema: numeric,
});

export const double: Operator = tool((input) => Number(input["value"]) * 2, {
  name: "double",
  description: "Doubles a number.",
  schema: numeric,
});

export const finish: Operator = {
  name: "finish",
  description: "Turns its value into the answer.",
  inputSchema: { type: "object", properties: { value: {} } },
  outputSchema: { type: "object", properties: { answer: {} } },
  run: async (input) => ({ answer: input["value"] }),
};

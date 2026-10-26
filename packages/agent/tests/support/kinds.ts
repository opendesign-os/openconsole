import { nodeId, type NodeId } from "@openconsole/graph";

import { tool, type JsonSchema, type Kind } from "../../index";

export const id = (value: string): NodeId => nodeId(value);

const numeric: JsonSchema = {
  type: "object",
  properties: { value: { type: "number" } },
  required: ["value"],
};

export const number: Kind = tool((input) => input["value"], {
  name: "number",
  description: "Returns its value.",
  schema: numeric,
});

export const double: Kind = tool((input) => Number(input["value"]) * 2, {
  name: "double",
  description: "Doubles a number.",
  schema: numeric,
});

export const sum: Kind = tool(
  (input) =>
    (input["values"] as number[]).reduce((total, value) => total + value, 0),
  {
    name: "sum",
    description: "Adds numbers.",
    schema: {
      type: "object",
      properties: { values: { type: "array", items: { type: "number" } } },
      required: ["values"],
    },
  },
);

export const boom: Kind = tool(
  () => {
    throw new Error("boom failed");
  },
  { name: "boom", description: "Always fails." },
);

export const finish: Kind = {
  name: "finish",
  description: "Turns its value into the answer.",
  inputSchema: { type: "object", properties: { value: {} } },
  outputSchema: { type: "object", properties: { answer: {} } },
  run: async (input) => ({ answer: input["value"] }),
};

export const route: Kind = {
  name: "route",
  description: "Sends its value out of the yes port only.",
  inputSchema: { type: "object", properties: { value: {} } },
  outputSchema: { type: "object", properties: { yes: {}, no: {} } },
  run: async (input) => ({ yes: input["value"] }),
};

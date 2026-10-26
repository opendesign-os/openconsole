import { Ajv, type SchemaObject, type ValidateFunction } from "ajv";

import { Port, Socket, type Ports } from "@openconsole/graph";

export type JsonSchema = Readonly<Record<string, unknown>>;

export type Values = Readonly<Record<string, unknown>>;

const ajv = new Ajv({ allErrors: true, strict: false });
const validators = new WeakMap<JsonSchema, ValidateFunction>();

const sockets: Readonly<Record<string, Socket>> = {
  string: Socket.string,
  number: Socket.number,
  integer: Socket.number,
  boolean: Socket.boolean,
  object: Socket.object,
  array: Socket.array,
};

export function check(schema: JsonSchema, value: unknown): string[] {
  let validate = validators.get(schema);
  if (validate === undefined) {
    const copy: Record<string, unknown> = { ...schema };
    delete copy["$schema"];
    validate = ajv.compile(copy as SchemaObject);
    validators.set(schema, validate);
  }
  if (validate(value)) return [];
  return (validate.errors ?? []).map(
    (error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
  );
}

export function properties(
  schema: JsonSchema,
): Readonly<Record<string, JsonSchema>> {
  const found = schema["properties"];
  return typeof found === "object" && found !== null
    ? (found as Record<string, JsonSchema>)
    : {};
}

export function gathers(schema: JsonSchema, port: string): boolean {
  return properties(schema)[port]?.["type"] === "array";
}

export function portsOf(schema: JsonSchema, side: "input" | "output"): Ports {
  const required = new Set(
    Array.isArray(schema["required"]) ? (schema["required"] as string[]) : [],
  );
  const ports: Record<string, Port> = {};
  for (const [name, property] of Object.entries(properties(schema))) {
    const type = property["type"];
    const array = type === "array";
    const typed = typeof type === "string" ? sockets[type] : undefined;
    ports[name] = new Port(
      side === "input" && array ? Socket.any : (typed ?? Socket.any),
      { multiple: side === "output" || array, required: required.has(name) },
    );
  }
  return ports;
}

export function extract(text: string): Values | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < start) return undefined;
  try {
    const parsed: unknown = JSON.parse(body.slice(start, end + 1));
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Values)
      : undefined;
  } catch {
    return undefined;
  }
}

export function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value);
}

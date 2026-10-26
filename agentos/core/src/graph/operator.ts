import type { NodeId } from "@openconsole/graph";

import { DefinitionError } from "./error";
import type { Plan } from "./plan";
import type { JsonSchema, Values } from "./schema";

export interface Usage {
  readonly input: number;
  readonly output: number;
}

export interface Scope {
  readonly run: string;
  readonly session: string;
  readonly user?: string | undefined;
}

export interface Limits {
  readonly nodes?: number;
  readonly tokens?: number;
  readonly concurrency?: number;
}

export interface Context {
  readonly node: NodeId;
  readonly parent: NodeId | undefined;
  readonly scope: Scope;
  readonly input: Values;
  readonly signal: AbortSignal;
  readonly remaining: number;
  spend(usage: Usage): void;
  emit(text: string): void;
  publish(data: unknown): void;
  interrupt(value: unknown): unknown;
  grow(plan: Plan): readonly NodeId[];
}

export interface Policy {
  readonly attempts?: number;
  readonly delay?: number;
  readonly factor?: number;
  readonly timeout?: number;
  readonly retry?: (error: unknown) => boolean;
  readonly cache?: number;
}

export interface Operator {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly outputSchema: JsonSchema;
  readonly plans?: boolean;
  readonly uses?: readonly Operator[];
  readonly policy?: Policy;
  run(input: Values, context: Context): Promise<Values>;
  recover?(error: unknown, input: Values, context: Context): Promise<Values>;
}

export interface ToolFields {
  readonly name: string;
  readonly description: string;
  readonly schema?: JsonSchema;
  readonly policy?: Policy;
}

export type Registry = ReadonlyMap<string, Operator>;

export const fault: Operator = {
  name: "fault",
  description:
    "Carries an error found while planning, so it reaches the next step as a failure.",
  inputSchema: {
    type: "object",
    properties: { error: { type: "string" } },
    required: ["error"],
  },
  outputSchema: { type: "object", properties: { result: {} } },
  run: (input) => Promise.reject(new Error(String(input["error"]))),
};

export function registry(...operators: readonly Operator[]): Registry {
  const found = new Map<string, Operator>();
  const visit = (operator: Operator): void => {
    const known = found.get(operator.name);
    if (known === operator) return;
    if (known !== undefined) {
      throw new DefinitionError(
        `two different operators are named ${operator.name}`,
      );
    }
    found.set(operator.name, operator);
    for (const used of operator.uses ?? []) visit(used);
  };
  for (const operator of operators) visit(operator);
  return found;
}

export function lookup(
  operators: Registry,
  name: string,
): Operator | undefined {
  return operators.get(name) ?? (name === fault.name ? fault : undefined);
}

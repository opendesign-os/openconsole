import { nodeId, type NodeId } from "@openconsole/graph";

import { GraphValueError } from "./error";
import type { JsonSchema, Values } from "./schema";

export interface Usage {
  readonly input: number;
  readonly output: number;
}

export interface Weight {
  readonly kind: string;
  readonly values: Values;
}

export interface Step {
  readonly id: NodeId;
  readonly kind: string;
  readonly values?: Values;
  readonly parent?: NodeId | null;
}

export interface Edge {
  readonly from: readonly [NodeId, string];
  readonly to: readonly [NodeId, string];
}

export interface Plan {
  readonly steps: readonly Step[];
  readonly edges?: readonly Edge[];
}

export interface Context {
  readonly node: NodeId;
  readonly parent: NodeId | undefined;
  readonly input: Values;
  readonly signal: AbortSignal;
  readonly remaining: number;
  spend(usage: Usage): void;
  emit(text: string): void;
  writer(chunk: unknown): void;
  interrupt(value: unknown): unknown;
  grow(plan: Plan): readonly NodeId[];
}

export interface Kind {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly outputSchema: JsonSchema;
  readonly plans?: boolean;
  readonly uses?: readonly Kind[];
  run(input: Values, context: Context): Promise<Values>;
}

export interface ToolFields {
  readonly name: string;
  readonly description: string;
  readonly schema?: JsonSchema;
}

export type Registry = ReadonlyMap<string, Kind>;

export const fault: Kind = {
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

export function registry(...kinds: readonly Kind[]): Registry {
  const found = new Map<string, Kind>();
  const visit = (kind: Kind): void => {
    const known = found.get(kind.name);
    if (known === kind) return;
    if (known !== undefined) {
      throw new GraphValueError(`two different kinds are named ${kind.name}`);
    }
    found.set(kind.name, kind);
    for (const used of kind.uses ?? []) visit(used);
  };
  for (const kind of kinds) visit(kind);
  return found;
}

export function lookup(kinds: Registry, name: string): Kind | undefined {
  return kinds.get(name) ?? (name === fault.name ? fault : undefined);
}

export function successor(node: NodeId, round: number): NodeId {
  return nodeId(`${node.replace(/~\d+$/, "")}~${round}`);
}

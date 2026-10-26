import { nodeId, type NodeId } from "@openconsole/graph";

import type { Values } from "./schema";

export interface Weight {
  readonly operator: string;
  readonly values: Values;
}

export interface Step {
  readonly id: NodeId;
  readonly operator: string;
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

export function successor(node: NodeId, round: number): NodeId {
  return nodeId(`${node.replace(/~\d+$/, "")}~${round}`);
}

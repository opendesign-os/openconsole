import { Graph, graphId, nodeId } from "@openconsole/graph";

import {
  GraphValueError,
  lookup,
  portsOf,
  type Registry,
  type Values,
  type Weight,
} from "../common";

export interface Outline {
  readonly nodes: readonly {
    readonly id: string;
    readonly kind: string;
    readonly values?: Values;
    readonly parent?: string;
  }[];
  readonly edges: readonly {
    readonly from: readonly [string, string];
    readonly to: readonly [string, string];
    readonly weight?: unknown;
  }[];
}

export function outline(graph: Graph<Weight>): Outline {
  const nodes = graph.nodes().map((id) => {
    const weight = graph.nodeWeight(id);
    const parent = graph.parent(id);
    return {
      id,
      kind: weight?.kind ?? "",
      ...(weight === undefined || Object.keys(weight.values).length === 0
        ? {}
        : { values: weight.values }),
      ...(parent === undefined ? {} : { parent }),
    };
  });
  const edges: Outline["edges"][number][] = [];
  graph.forEachEdge((edge) => {
    edges.push({
      from: [edge.source, edge.sourcePort],
      to: [edge.target, edge.targetPort],
      ...(edge.weight === undefined ? {} : { weight: edge.weight }),
    });
  });
  return { nodes, edges };
}

export function assemble(
  outline: Outline,
  kinds: Registry,
  id = "template",
): Graph<Weight> {
  const graph = new Graph<Weight>(graphId(id));
  graph.batch(() => {
    for (const node of outline.nodes) {
      const kind = lookup(kinds, node.kind);
      if (kind === undefined) {
        throw new GraphValueError(`unknown kind ${node.kind}`);
      }
      graph.addNode({
        id: nodeId(node.id),
        weight: { kind: node.kind, values: node.values ?? {} },
        inputs: portsOf(kind.inputSchema, "input"),
        outputs: portsOf(kind.outputSchema, "output"),
      });
    }
    for (const node of outline.nodes) {
      if (node.parent !== undefined) {
        graph.setParent(nodeId(node.id), nodeId(node.parent));
      }
    }
    for (const edge of outline.edges) {
      graph.connect(
        [nodeId(edge.from[0]), edge.from[1]],
        [nodeId(edge.to[0]), edge.to[1]],
        edge.weight === undefined ? {} : { weight: edge.weight },
      );
    }
  });
  return graph;
}

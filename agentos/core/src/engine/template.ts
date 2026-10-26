import { Graph, graphId, nodeId } from "@openconsole/graph";

import {
  DefinitionError,
  lookup,
  ports,
  type Registry,
  type Values,
  type Weight,
} from "../graph";

export interface Outline {
  readonly nodes: readonly {
    readonly id: string;
    readonly operator: string;
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
      operator: weight?.operator ?? "",
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
  operators: Registry,
  id = "template",
): Graph<Weight> {
  const graph = new Graph<Weight>(graphId(id));
  graph.batch(() => {
    for (const node of outline.nodes) {
      const operator = lookup(operators, node.operator);
      if (operator === undefined) {
        throw new DefinitionError(`unknown operator ${node.operator}`);
      }
      graph.addNode({
        id: nodeId(node.id),
        weight: { operator: node.operator, values: node.values ?? {} },
        inputs: ports(operator.inputSchema, "input"),
        outputs: ports(operator.outputSchema, "output"),
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

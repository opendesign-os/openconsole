import { Graph, graphId, nodeId, type NodeId } from "@openconsole/graph";

import {
  GraphValueError,
  lookup,
  portsOf,
  properties,
  registry,
  type Kind,
  type Registry,
  type Values,
  type Weight,
} from "../common";
import { assemble, outline, type Outline } from "../runtime";
import { CompiledFlowGraph, type CompileOptions } from "./compiled";

export interface NodeOptions {
  readonly input?: Values;
  readonly parent?: string;
}

export interface EdgeOptions {
  readonly probability?: number;
}

export class FlowGraph {
  private readonly _graph: Graph<Weight>;
  private readonly _kinds = new Map<string, Kind>();

  public constructor(template?: Graph<Weight>, kinds: Iterable<Kind> = []) {
    this._graph = template ?? new Graph<Weight>(graphId("flow"));
    for (const kind of kinds) this._register(kind);
  }

  public static from(source: Outline, kinds: Iterable<Kind>): FlowGraph {
    const known = registry(...kinds);
    return new FlowGraph(assemble(source, known, "flow"), known.values());
  }

  public get template(): Graph<Weight> {
    return this._graph;
  }

  public get kinds(): Registry {
    return this._kinds;
  }

  public addNode(name: string, kind: Kind, options: NodeOptions = {}): this {
    const id = nodeId(name);
    if (this._graph.hasNode(id)) {
      throw new GraphValueError(`node ${name} already exists`);
    }
    this._register(kind);
    this._graph.addNode({
      id,
      weight: { kind: kind.name, values: options.input ?? {} },
      inputs: portsOf(kind.inputSchema, "input"),
      outputs: portsOf(kind.outputSchema, "output"),
    });
    if (options.parent !== undefined) {
      this._graph.setParent(id, this._node(options.parent));
    }
    return this;
  }

  public addEdge(start: string, end: string, options: EdgeOptions = {}): this {
    const from = this._endpoint(start, "output");
    const to = this._endpoint(end, "input", from[1]);
    try {
      this._graph.connect(
        from,
        to,
        options.probability === undefined
          ? {}
          : { weight: { probability: options.probability } },
      );
    } catch (error) {
      throw new GraphValueError(
        `cannot connect ${start} to ${end}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return this;
  }

  public compile(options: CompileOptions = {}): CompiledFlowGraph {
    return new CompiledFlowGraph(
      this._graph.copy(),
      new Map(this._kinds),
      options,
    );
  }

  public copy(): FlowGraph {
    return new FlowGraph(this._graph.copy(), this._kinds.values());
  }

  public toJSON(): Outline {
    return outline(this._graph);
  }

  private _register(kind: Kind): void {
    for (const found of registry(kind).values()) {
      const known = this._kinds.get(found.name);
      if (known !== undefined && known !== found) {
        throw new GraphValueError(
          `two different kinds are named ${found.name}`,
        );
      }
      this._kinds.set(found.name, found);
    }
  }

  private _node(name: string): NodeId {
    const id = nodeId(name);
    if (!this._graph.hasNode(id))
      throw new GraphValueError(`unknown node ${name}`);
    return id;
  }

  private _endpoint(
    text: string,
    side: "input" | "output",
    hint?: string,
  ): readonly [NodeId, string] {
    const dot = text.lastIndexOf(".");
    const qualified =
      dot > 0 && this._graph.hasNode(nodeId(text.slice(0, dot)));
    const node = this._node(qualified ? text.slice(0, dot) : text);
    const kind = lookup(this._kinds, this._graph.nodeWeight(node)?.kind ?? "");
    const schema = side === "input" ? kind?.inputSchema : kind?.outputSchema;
    const names = schema === undefined ? [] : Object.keys(properties(schema));
    const chosen = qualified
      ? text.slice(dot + 1)
      : names.length === 1
        ? names[0]
        : side === "output" && names.includes("result")
          ? "result"
          : hint !== undefined && names.includes(hint)
            ? hint
            : undefined;
    if (chosen === undefined || !names.includes(chosen)) {
      throw new GraphValueError(
        `name the ${side} port of ${node}: ${names.join(", ") || "it has none"}`,
      );
    }
    return [node, chosen];
  }
}

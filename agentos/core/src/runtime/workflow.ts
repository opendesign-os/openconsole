import { Graph, graphId, nodeId, type NodeId } from "@openconsole/graph";

import { assemble, outline, type Outline } from "../engine";
import {
  DefinitionError,
  lookup,
  ports,
  properties,
  registry,
  type Operator,
  type Registry,
  type Values,
  type Weight,
} from "../graph";
import { nest, Runner, type Blueprint, type RunnerOptions } from "./runner";

export interface NodeOptions {
  readonly input?: Values;
  readonly parent?: string;
}

export interface EdgeOptions {
  readonly probability?: number;
}

export class Workflow extends Runner {
  private readonly _graph: Graph<Weight>;
  private readonly _operators = new Map<string, Operator>();

  public constructor(
    private readonly _options: RunnerOptions,
    template?: Graph<Weight>,
    operators: Iterable<Operator> = [],
  ) {
    super(_options);
    this._graph = template ?? new Graph<Weight>(graphId(_options.name));
    for (const operator of operators) this._register(operator);
  }

  public static from(
    source: Outline,
    operators: Iterable<Operator>,
    options: RunnerOptions,
  ): Workflow {
    const known = registry(...operators);
    return new Workflow(
      options,
      assemble(source, known, options.name),
      known.values(),
    );
  }

  public get template(): Graph<Weight> {
    return this._graph;
  }

  public get operators(): Registry {
    return this._operators;
  }

  public node(
    name: string,
    operator: Operator | Runner,
    options: NodeOptions = {},
  ): this {
    const id = nodeId(name);
    if (this._graph.hasNode(id)) {
      throw new DefinitionError(`node ${name} already exists`);
    }
    const resolved = operator instanceof Runner ? nest(operator) : operator;
    this._register(resolved);
    this._graph.addNode({
      id,
      weight: { operator: resolved.name, values: options.input ?? {} },
      inputs: ports(resolved.inputSchema, "input"),
      outputs: ports(resolved.outputSchema, "output"),
    });
    if (options.parent !== undefined) {
      this._graph.setParent(id, this._node(options.parent));
    }
    return this;
  }

  public edge(start: string, end: string, options: EdgeOptions = {}): this {
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
      throw new DefinitionError(
        `cannot connect ${start} to ${end}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return this;
  }

  public copy(): Workflow {
    return new Workflow(
      this._options,
      this._graph.copy(),
      this._operators.values(),
    );
  }

  public toJSON(): Outline {
    return outline(this._graph);
  }

  protected async blueprint(): Promise<Blueprint> {
    return { template: this._graph, operators: this._operators };
  }

  private _register(operator: Operator): void {
    for (const found of registry(operator).values()) {
      const known = this._operators.get(found.name);
      if (known !== undefined && known !== found) {
        throw new DefinitionError(
          `two different operators are named ${found.name}`,
        );
      }
      this._operators.set(found.name, found);
    }
  }

  private _node(name: string): NodeId {
    const id = nodeId(name);
    if (!this._graph.hasNode(id)) {
      throw new DefinitionError(`unknown node ${name}`);
    }
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
    const operator = lookup(
      this._operators,
      this._graph.nodeWeight(node)?.operator ?? "",
    );
    const schema =
      side === "input" ? operator?.inputSchema : operator?.outputSchema;
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
      throw new DefinitionError(
        `name the ${side} port of ${node}: ${names.join(", ") || "it has none"}`,
      );
    }
    return [node, chosen];
  }
}

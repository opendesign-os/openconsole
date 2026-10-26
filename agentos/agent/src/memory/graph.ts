import {
  Graph,
  graphId,
  nodeId,
  pack,
  Port,
  Socket,
  unpack,
  type Bundle,
  type EdgeId,
  type NodeId,
} from "@openconsole/graph";

export interface Entity {
  readonly name: string;
  readonly summary: string;
  readonly episodes: readonly string[];
}

export interface Fact {
  readonly relation: string;
  readonly statement: string;
  readonly since: string;
  readonly until?: string | undefined;
  readonly episodes: readonly string[];
}

export interface Triple {
  readonly subject: string;
  readonly relation: string;
  readonly object: string;
}

export interface Update {
  readonly entities?: readonly {
    readonly name: string;
    readonly summary: string;
  }[];
  readonly facts?: readonly (Triple & { readonly statement: string })[];
  readonly expired?: readonly Triple[];
}

export interface Episode {
  readonly id: string;
  readonly time: string;
}

const RESTART = 0.5;
const ROUNDS = 20;
const PORT = new Port(Socket.any);

export class Memory {
  private readonly _graph: Graph<Entity, Fact>;

  public constructor(bundle?: Bundle<Entity, Fact>) {
    this._graph =
      bundle === undefined
        ? new Graph<Entity, Fact>(graphId("memory"))
        : unpack(bundle);
  }

  public get entities(): number {
    return this._graph.order;
  }

  public get facts(): number {
    let count = 0;
    this._graph.forEachEdge((edge) => {
      if (edge.weight?.until === undefined) count++;
    });
    return count;
  }

  public merge(update: Update, episode: Episode): void {
    this._graph.batch(() => {
      for (const entity of update.entities ?? []) {
        this._entity(entity.name, episode, entity.summary);
      }
      for (const fact of update.facts ?? []) {
        const subject = this._entity(fact.subject, episode);
        const object = this._entity(fact.object, episode);
        if (subject === object) continue;
        const relation = label(fact.relation);
        const edge = this._fact(subject, relation, object);
        const known =
          edge === undefined ? undefined : this._graph.edgeWeight(edge);
        if (edge === undefined || known === undefined) {
          this._graph.connect([subject, "out"], [object, "in"], {
            weight: {
              relation,
              statement: fact.statement,
              since: episode.time,
              episodes: [episode.id],
            },
          });
        } else {
          this._graph.setEdgeWeight(edge, {
            ...known,
            statement: fact.statement,
            episodes: join(known.episodes, episode.id),
          });
        }
      }
      for (const triple of update.expired ?? []) {
        const subject = nodeId(key(triple.subject));
        const object = nodeId(key(triple.object));
        if (!this._graph.hasNode(subject) || !this._graph.hasNode(object)) {
          continue;
        }
        const edge = this._fact(subject, label(triple.relation), object);
        const known =
          edge === undefined ? undefined : this._graph.edgeWeight(edge);
        if (edge !== undefined && known !== undefined) {
          this._graph.setEdgeWeight(edge, { ...known, until: episode.time });
        }
      }
    });
  }

  public recall(query: string, budget = 1_500): string {
    if (this._graph.order === 0) return "";
    const scores = this._rank(query);
    const facts: Array<readonly [number, Fact]> = [];
    this._graph.forEachEdge((edge) => {
      const fact = edge.weight;
      if (fact === undefined || fact.until !== undefined) return;
      const score =
        (scores.get(edge.source) ?? 0) + (scores.get(edge.target) ?? 0);
      facts.push([score, fact]);
    });
    facts.sort(([a, x], [b, y]) => b - a || (x.since < y.since ? 1 : -1));
    const entities = this._graph
      .nodes()
      .flatMap((node): Array<readonly [number, Entity]> => {
        const entity = this._graph.nodeWeight(node);
        return entity === undefined || entity.summary === ""
          ? []
          : [[scores.get(node) ?? 0, entity]];
      })
      .sort(([a], [b]) => b - a);
    let used = 0;
    const take = (lines: string[], line: string): boolean => {
      const cost = approximate(line);
      if (used + cost > budget) return false;
      used += cost;
      lines.push(line);
      return true;
    };
    const known: string[] = [];
    for (const [, fact] of facts) {
      if (
        !take(known, `- ${fact.statement} (since ${fact.since.slice(0, 10)})`)
      ) {
        break;
      }
    }
    const described: string[] = [];
    for (const [, entity] of entities) {
      if (!take(described, `- ${entity.name}: ${entity.summary}`)) break;
    }
    return [
      known.length === 0 ? "" : `<facts>\n${known.join("\n")}\n</facts>`,
      described.length === 0
        ? ""
        : `<entities>\n${described.join("\n")}\n</entities>`,
    ]
      .filter((section) => section !== "")
      .join("\n");
  }

  public pack(): Bundle<Entity, Fact> {
    return pack(this._graph);
  }

  private _entity(name: string, episode: Episode, summary?: string): NodeId {
    const id = nodeId(key(name));
    const known = this._graph.nodeWeight(id);
    if (!this._graph.hasNode(id)) {
      this._graph.addNode({
        id,
        weight: {
          name: name.trim(),
          summary: summary ?? "",
          episodes: [episode.id],
        },
        inputs: { in: PORT },
        outputs: { out: PORT },
      });
    } else if (known !== undefined) {
      this._graph.setWeight(id, {
        ...known,
        summary:
          summary === undefined || summary === "" ? known.summary : summary,
        episodes: join(known.episodes, episode.id),
      });
    }
    return id;
  }

  private _fact(
    subject: NodeId,
    relation: string,
    object: NodeId,
  ): EdgeId | undefined {
    for (const edge of this._graph.outEdges(subject)) {
      const record = this._graph.edge(edge);
      if (
        record?.target === object &&
        record.weight?.relation === relation &&
        record.weight.until === undefined
      ) {
        return edge;
      }
    }
    return undefined;
  }

  private _rank(query: string): Map<NodeId, number> {
    const text = key(query);
    const nodes = this._graph.nodes();
    const seeds = new Map<NodeId, number>();
    for (const node of nodes) {
      const entity = this._graph.nodeWeight(node);
      const name = entity === undefined ? "" : key(entity.name);
      if (entity !== undefined && name.length > 1 && text.includes(name)) {
        seeds.set(node, 1 / Math.max(1, entity.episodes.length));
      }
    }
    if (seeds.size === 0) for (const node of nodes) seeds.set(node, 1);
    let total = 0;
    for (const weight of seeds.values()) total += weight;
    const restart = new Map<NodeId, number>();
    for (const [node, weight] of seeds) restart.set(node, weight / total);

    const around = new Map<NodeId, NodeId[]>();
    this._graph.forEachEdge((edge) => {
      if (edge.weight?.until !== undefined) return;
      around.set(edge.source, [
        ...(around.get(edge.source) ?? []),
        edge.target,
      ]);
      around.set(edge.target, [
        ...(around.get(edge.target) ?? []),
        edge.source,
      ]);
    });

    let scores = new Map(restart);
    for (let round = 0; round < ROUNDS; round++) {
      const next = new Map<NodeId, number>();
      for (const [node, weight] of restart) next.set(node, RESTART * weight);
      for (const [node, score] of scores) {
        const targets = around.get(node) ?? [];
        if (targets.length === 0) {
          for (const [seed, weight] of restart) {
            next.set(
              seed,
              (next.get(seed) ?? 0) + (1 - RESTART) * score * weight,
            );
          }
          continue;
        }
        const share = ((1 - RESTART) * score) / targets.length;
        for (const target of targets) {
          next.set(target, (next.get(target) ?? 0) + share);
        }
      }
      scores = next;
    }
    return scores;
  }
}

export function approximate(text: string): number {
  return Math.ceil(new TextEncoder().encode(text).length / 3);
}

function key(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function label(relation: string): string {
  return relation
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function join(list: readonly string[], item: string): readonly string[] {
  return list.includes(item) ? list : [...list, item];
}

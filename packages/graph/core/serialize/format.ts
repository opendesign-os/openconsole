import { Missing, Schema } from "../error";
import { Graph } from "../graph";
import {
  edgeId,
  nodeId,
  type EdgeId,
  type GraphId,
  type NodeId,
} from "../ident";
import { Interner } from "../slots";
import { builtins, type Socket } from "../socket";
import { Port, type Constraints } from "../vertex";

export const VERSION = 3 as const;

/** 端口的紧凑形态：`[名称, socket 名]`，带约束时追加第三项。 */
export type PortTuple =
  | readonly [string, string]
  | readonly [string, string, PortLimits];

/** 端口约束的紧凑形态；取缺省值的项一律省略。 */
export interface PortLimits {
  m?: false;
  r?: true;
  f?: unknown;
}

/**
 * 节点元组：`[id, 输入端口, 输出端口]`，带权重时追加第四项。
 *
 * @remarks 无权重时**省略**该位而不是写 `undefined`——JSON 会把数组里的 `undefined`
 *   写成 `null`，往返一趟后"没有权重"就静默变成了"权重是 null"。省略位让两者在
 *   JSON 里也分得开：`undefined` 往返仍是 `undefined`，显式的 `null` 权重保留为 `null`。
 */
export type CompactNode<N = unknown> = readonly [
  NodeId,
  ReadonlyArray<PortTuple> | null,
  ReadonlyArray<PortTuple> | null,
  N?,
];

/** 边元组：`[id, 源, 源端口, 目标, 目标端口]`，带权重时追加第六项；省略语义同 {@link CompactNode}。 */
export type CompactEdge<E = unknown> = readonly [
  EdgeId,
  NodeId,
  string,
  NodeId,
  string,
  E?,
];

/** 权重类型跟着图走，因此还原时不需要任何断言。 */
export interface Compact<N = unknown, E = unknown> {
  readonly v: number;
  readonly g: GraphId;
  readonly n: ReadonlyArray<CompactNode<N>>;
  readonly e: ReadonlyArray<CompactEdge<E>>;
  readonly h?: ReadonlyArray<readonly [NodeId, NodeId]>;
}

/** 启用 intern 时的原始 id 表，下标即短 id。 */
export interface IdTable {
  readonly nodes: ReadonlyArray<string>;
  readonly edges: ReadonlyArray<string>;
}

export interface Bundle<N = unknown, E = unknown> {
  readonly compact: Compact<N, E>;
  readonly ids?: IdTable;
}

export type SocketLookup = ReadonlyMap<string, Socket> | ReadonlyArray<Socket>;

export interface PackOptions {
  /**
   * 节点写出顺序，默认按图内顺序；传拓扑序可得到稳定输出。
   * 必须与图内节点一一对应：漏或重都抛 {@link Schema}。图里不存在的 id 被忽略——
   * 顺序常来自略旧的快照，多出来的名字无害。
   */
  order?: Iterable<NodeId>;
  /** 把长 id 折算成短整数，另附还原表。 */
  intern?: boolean;
}

export interface UnpackOptions<N, E> {
  sockets?: SocketLookup;
  /**
   * 写入已有的图（先清空）而不是新建。
   *
   * @remarks 失败不回滚：unpack 中途抛错（版本不符、缺 socket 表）时目标图已被清空
   *   并写入了一半。要么先对 bundle 做一次试还原，要么自备恢复手段。
   */
  into?: Graph<N, E>;
  /** 把 intern 过的短 id 还原成原始 id，默认开启；关掉则原样保留短 id。 */
  revive?: boolean;
}

/** 端口表 → 紧凑元组，按名称排序以便直接比较两份结构。 */
export function tuples(
  ports: Readonly<Record<string, Port | undefined>>,
): ReadonlyArray<PortTuple> | null {
  const listed: PortTuple[] = [];
  for (const name of Object.keys(ports).sort()) {
    const port = ports[name];
    if (!port) continue;
    const limits: PortLimits = {};
    if (!port.multiple) limits.m = false;
    if (port.required) limits.r = true;
    if (port.fallback !== undefined) limits.f = port.fallback;
    listed.push(
      Object.keys(limits).length > 0
        ? [name, port.socket.name, limits]
        : [name, port.socket.name],
    );
  }
  return listed.length > 0 ? listed : null;
}

/** @throws {@link Missing} socket 名不在查找表里——自定义 socket 经 `UnpackOptions.sockets` 传入 */
export function restore(
  listed: ReadonlyArray<PortTuple> | null,
  sockets: ReadonlyMap<string, Socket>,
): Record<string, Port> {
  const ports: Record<string, Port> = {};
  for (const [name, socket, packed] of listed ?? []) {
    const found = sockets.get(socket);
    if (found === undefined) {
      throw new Missing("socket", socket, "pass it via UnpackOptions.sockets");
    }
    const constraints: Constraints = {};
    if (packed?.m === false) constraints.multiple = false;
    if (packed?.r === true) constraints.required = true;
    if (packed?.f !== undefined) constraints.fallback = packed.f;
    ports[name] = new Port(found, constraints);
  }
  return ports;
}

export function resolve(custom?: SocketLookup): ReadonlyMap<string, Socket> {
  if (!custom) return builtins;
  const merged = new Map(builtins);
  const listed = Array.isArray(custom) ? custom : [...custom.values()];
  for (const socket of listed) merged.set(socket.name, socket);
  return merged;
}

/** 短 id 反查原始 id；表与数据对不上时明确报错，而不是悄悄产出 undefined。 */
function original(
  table: ReadonlyArray<string>,
  short: string,
  kind: "node" | "edge",
): string {
  const found = table[Number(short)];
  if (found === undefined) throw new Missing(kind, short, "id table");
  return found;
}

/**
 * 权重为 `undefined` 时省略尾位；两个 `packed` 是元组化格式里唯一需要判省略的地方。
 * 见 {@link CompactNode} 的省略语义。
 */
const packedNode = <N>(
  id: NodeId,
  inputs: ReadonlyArray<PortTuple> | null,
  outputs: ReadonlyArray<PortTuple> | null,
  weight: N | undefined,
): CompactNode<N> =>
  weight === undefined ? [id, inputs, outputs] : [id, inputs, outputs, weight];

const packedEdge = <E>(
  id: EdgeId,
  source: NodeId,
  sourcePort: string,
  target: NodeId,
  targetPort: string,
  weight: E | undefined,
): CompactEdge<E> =>
  weight === undefined
    ? [id, source, sourcePort, target, targetPort]
    : [id, source, sourcePort, target, targetPort, weight];

/**
 * 元组化紧凑格式，保留端口约束与复合层级。
 *
 * @throws {@link Schema} `order` 没有一一覆盖图内全部节点。漏掉的节点会让边引用到
 *   不存在的端点，`unpack` 时才在远处报错；重复的节点则要到那时才撞 `Duplicate`。
 */
export function pack<N, E>(
  graph: Graph<N, E>,
  options: PackOptions = {},
): Bundle<N, E> {
  const intern = options.intern === true;
  const nodeIds = new Interner();
  const edgeIds = new Interner();
  const mapNode = (id: NodeId): NodeId =>
    intern ? nodeId(String(nodeIds.of(id))) : id;
  const mapEdge = (id: EdgeId): EdgeId =>
    intern ? edgeId(String(edgeIds.of(id))) : id;

  // 全图扫描一律走 forEach* 快路径：按存储顺序直读平行数组，省掉每个元素一次 id 查表。
  const n: Array<CompactNode<N>> = [];
  if (options.order === undefined) {
    graph.forEachNode((id, weight, slot) => {
      const { inputs, outputs } = graph.nodeAt(slot)!;
      n.push(packedNode(mapNode(id), tuples(inputs), tuples(outputs), weight));
    });
  } else {
    for (const id of options.order) {
      const record = graph.node(id);
      if (!record) continue;
      n.push(
        packedNode(
          mapNode(record.id),
          tuples(record.inputs),
          tuples(record.outputs),
          record.weight,
        ),
      );
    }
    // 一个计数同时兜住漏与重：漏则短，重则长。
    if (n.length !== graph.order) {
      throw new Schema(
        `PackOptions.order yields ${n.length} entries for ${graph.order} node(s)`,
      );
    }
  }

  const e: Array<CompactEdge<E>> = [];
  graph.forEachEdge((record) => {
    e.push(
      packedEdge(
        mapEdge(record.id),
        mapNode(record.source),
        record.sourcePort,
        mapNode(record.target),
        record.targetPort,
        record.weight,
      ),
    );
  });

  const h: Array<readonly [NodeId, NodeId]> = [];
  graph.forEachParent((node, parent) => {
    h.push([mapNode(node), mapNode(parent)]);
  });

  const compact: Compact<N, E> =
    h.length > 0
      ? { v: VERSION, g: graph.id, n, e, h }
      : { v: VERSION, g: graph.id, n, e };
  return intern
    ? { compact, ids: { nodes: nodeIds.table, edges: edgeIds.table } }
    : { compact };
}

/** @throws {@link Schema} 版本不匹配 */
export function unpack<N, E>(
  bundle: Bundle<N, E>,
  options: UnpackOptions<N, E> = {},
): Graph<N, E> {
  const { compact, ids } = bundle;
  if (compact.v !== VERSION) {
    throw new Schema(
      `unsupported schema version ${String(compact.v)} (expected ${VERSION})`,
    );
  }

  const revive = ids && options.revive !== false;
  const node = (id: NodeId): NodeId =>
    revive ? nodeId(original(ids.nodes, id, "node")) : id;
  const edge = (id: EdgeId): EdgeId =>
    revive ? edgeId(original(ids.edges, id, "edge")) : id;

  const sockets = resolve(options.sockets);
  const graph = options.into ?? new Graph<N, E>(compact.g);
  if (options.into) graph.clear();

  return graph.batch(() => {
    for (const [id, inputs, outputs, weight] of compact.n) {
      graph.addNode({
        id: node(id),
        weight,
        inputs: restore(inputs, sockets),
        outputs: restore(outputs, sockets),
      });
    }
    for (const [
      id,
      source,
      sourcePort,
      target,
      targetPort,
      weight,
    ] of compact.e) {
      graph.connect([node(source), sourcePort], [node(target), targetPort], {
        id: edge(id),
        weight,
      });
    }
    for (const [child, parent] of compact.h ?? []) {
      graph.setParent(node(child), node(parent));
    }
    return graph;
  });
}

/** 逐字段展开的可读形态，用作压缩率的对照基准。 */
export function expand<N, E>(graph: Graph<N, E>): unknown {
  return {
    id: graph.id,
    nodes: graph.nodes().map((id) => {
      const record = graph.node(id)!;
      const ports = (
        listed: Readonly<Record<string, Port | undefined>>,
      ): unknown =>
        Object.fromEntries(
          Object.entries(listed)
            .filter((entry): entry is [string, Port] => entry[1] !== undefined)
            .map(([name, port]) => [
              name,
              {
                socket: port.socket.name,
                multiple: port.multiple,
                required: port.required,
                fallback: port.fallback,
              },
            ]),
        );
      return {
        id: record.id,
        weight: record.weight,
        inputs: ports(record.inputs),
        outputs: ports(record.outputs),
      };
    }),
    edges: graph.edges().map((id) => graph.edge(id)),
    hierarchy: graph
      .nodes()
      .filter((id) => graph.parent(id) !== undefined)
      .map((id) => [id, graph.parent(id)]),
  };
}

const encoder = new TextEncoder();

/** 紧凑格式相对展开 JSON 的字节压缩率。 */
export function compression<N, E>(
  graph: Graph<N, E>,
): { original: number; packed: number; ratio: number } {
  const original = encoder.encode(JSON.stringify(expand(graph))).length;
  const packed = encoder.encode(JSON.stringify(pack(graph).compact)).length;
  return { original, packed, ratio: packed === 0 ? 0 : original / packed };
}

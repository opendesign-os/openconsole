import type { EdgeId, NodeId } from "./ident";
import type { Ports } from "./vertex";

/** 事务边界事件的载荷。 */
export interface Flushed {
  /** 本次事务里的变更条数。 */
  changes: number;
}

/**
 * 图的变更事件。载荷是值快照而非活对象，因此在事务中缓冲、稍后派发也不会读到已失效的状态。
 *
 * 派发时机统一落在事务边界：单次变更自成一段事务，`batch` 是一整段事务，两者都在结束时
 * 先按序放出各条变更事件，再放一次 {@link Events.flushed}。载荷只在**变更发生时确有监听者**
 * 的情况下构造——没人听就连对象都不分配。
 *
 * 每条载荷都带 `slot`，即该节点 / 边在图内的整数索引。按索引维护增量状态的订阅者
 * （增量拓扑序、布局缓存）据此避免每条事件一次 id 哈希；槽位会被回收复用，
 * 但事件按发生顺序派发，顺序处理即可得到正确的最终状态。
 */
export interface Events<N = unknown, E = unknown> {
  nodeAdded: { node: NodeId; slot: number };
  nodeDropped: { node: NodeId; slot: number; weight: N | undefined };
  nodeUpdated: {
    node: NodeId;
    slot: number;
    before: N | undefined;
    after: N | undefined;
  };
  nodeReshaped: { node: NodeId; slot: number; inputs: Ports; outputs: Ports };
  edgeAdded: { edge: EdgeId; slot: number; source: NodeId; target: NodeId };
  edgeDropped: {
    edge: EdgeId;
    slot: number;
    source: NodeId;
    target: NodeId;
    weight: E | undefined;
  };
  edgeUpdated: {
    edge: EdgeId;
    slot: number;
    before: E | undefined;
    after: E | undefined;
  };
  parentChanged: {
    node: NodeId;
    slot: number;
    before: NodeId | undefined;
    after: NodeId | undefined;
  };
  /**
   * `compact()` 重新稠密编号。载荷是旧索引 → 新索引的映射，被回收的空位为 -1。
   * 任何按索引缓存的订阅者必须据此重映射，否则会静默错位。
   */
  compacted: { nodes: Int32Array; edges: Int32Array };
  /**
   * 事务边界：本次事务的变更事件都已派发完毕，`changes` 是其中的变更条数。
   * 下游（布局、增量拓扑序、渲染）据此把一整段编辑合并成一次重算。
   */
  flushed: Flushed;
}

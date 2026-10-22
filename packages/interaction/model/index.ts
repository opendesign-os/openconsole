/**
 * @file 模型层：与 DOM、输入方式都无关的数据与约定，是其余各层的共同基础。
 *
 * - `state`：统一状态 `State`（矩阵、尺寸、序号）与合并、取角点、取中心。
 * - `store`：同一节点上多项能力共享的 `Store`，带会话锁。
 * - `operation`：一次会话的净变化 `Operation`，以及求差、施加、撤回，用于撤销重做。
 * - `geometry`：区间、包围盒、多边形与参考线，以及面积、包含、裁剪等纯函数。
 * - `capability`：能力的基类 `Capability` 与改变几何的 `Shape`。
 */

export * from "./capability";
export * from "./geometry";
export * from "./operation";
export * from "./state";
export * from "./store";

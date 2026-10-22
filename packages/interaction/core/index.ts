/**
 * @file 核心层：与 DOM 无关的跟手管线与纯算法，可在 canvas、测试与回放中单独使用。
 *
 * - `tracker`：跟手管线 `Tracker` 与插件、输入、离散步进的约定。
 * - `action`：动作 `transform`、`resize` 及其自由度、锚点与钉边计算。
 * - `frame`：屏幕坐标与容器空间之间的换算。
 * - `choose`：多个命中目标里最内层优先的选择。
 * - `sorting`：排序的插入位置、位次与重排计划。
 * - `spatial`：放置判定用的空间索引 `Linear`、`Hash`。
 * - `tiling`：磁贴布局的放置、推开、紧凑与找空位。
 *
 * 包入口只转发其中的公开成员，其余供 DOM 层与能力层内部使用。
 */

export * from "./action";
export * from "./choose";
export * from "./frame";
export * from "./sorting";
export * from "./spatial";
export * from "./tiling";
export * from "./tracker";

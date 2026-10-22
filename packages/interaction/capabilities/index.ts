/**
 * @file 能力层：在 `bind` 之上预设好的常用交互，按选项组装动作、插件与按键，开箱即用。
 *
 * - 几何类能力继承 `Shape`，同一节点上共享一份状态，可以叠加挂载：
 *   `Draggable`（平移拖拽）、`Resizable`（调整尺寸）、`Rotatable`（旋转）、`Zoomable`（平移缩放画布）。
 * - 集合类能力继承 `Capability`，管理一组节点：`Sortable`（列表排序）、`Tileable`（网格磁贴布局）、
 *   `Nestable`（嵌套区域编辑）；它们的结果是结构变化，经各自的事件报告。
 * - `Droppable` 不绑定指针，只旁观所有绑定的拖拽会话并派发放置事件。
 *
 * 每项能力都以 `update()` 修改选项：能就地生效的直接应用，改变结构的选项才重建；`destroy()` 或
 * `options.signal` 中止时释放全部绑定与生成的元素。
 */

export * from "./draggable";
export * from "./droppable";
export * from "./nestable";
export * from "./resizable";
export * from "./rotatable";
export * from "./sortable";
export * from "./tileable";
export * from "./zoomable";

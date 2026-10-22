/**
 * @file `@openconsole/interaction` 的公开入口。
 *
 * 自下而上分为五层，上层只依赖下层（`plugins/` 与 `dom/` 互不依赖）：
 *
 * - `model/`：统一状态、共享存储、元操作、几何与能力基类，不引用 DOM。
 * - `core/`：跟手管线 `Tracker`、动作、插件契约、空间索引与布局算法，不引用 DOM，
 *   可用于 canvas、测试与回放。
 * - `plugins/`：约束与吸附插件（网格、边界、碰撞、磁吸、角度、尺寸范围）。
 * - `dom/`：把节点接入管线的 `bind`、指针/键盘/滚轮输入源、测量、渲染与视觉辅助。
 * - `capabilities/`：开箱即用的能力类（拖拽、放置、调整尺寸、排序、旋转、平移缩放、磁贴、嵌套）。
 *
 * `capabilities/` 与 `plugins/` 整体转发；`model/`、`core/`、`dom/` 显式列出公开成员，
 * 状态合并、移动计划、目标选择、样式折叠、视图、输入路由与测量等内部函数不对外导出。
 */

export * from "./capabilities";
export {
  bottom,
  closest,
  Hash,
  Linear,
  place,
  resize,
  settle,
  Tracker,
  transform,
  vacant,
  type Action,
  type Context,
  type Edges,
  type Freedom,
  type Handle,
  type Index,
  type Input,
  type Layout,
  type Modifiers,
  type Plugin,
  type Slot,
  type Step,
  type Tile,
  type Tiling,
  type TrackerOptions,
} from "./core";
export {
  bind,
  gridlines,
  guides,
  keyboard,
  observe,
  outlines,
  pointer,
  transfer,
  wheel,
  type Activation,
  type Binding,
  type BindOptions,
  type Control,
  type Elements,
  type Key,
  type Keys,
  type Mark,
  type Observer,
  type Render,
  type Sensor,
  type Session,
} from "./dom";
export {
  area,
  Capability,
  center,
  centroid,
  contains,
  corners,
  delta,
  extent,
  intersect,
  perform,
  revert,
  Shape,
  Store,
  type Bounds,
  type CapabilityOptions,
  type Guide,
  type Member,
  type Operation,
  type Part,
  type Patch,
  type Polygon,
  type Range,
  type Size,
  type State,
  type Unit,
} from "./model";
export * from "./plugins";

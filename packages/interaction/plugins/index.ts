/**
 * @file 插件层：按动作自由度约束或吸附候选状态的内置插件。
 *
 * - 吸附：`grid`（网格步长）、`angle`（角度步长）、`magnet`（对齐与等间距，输出参考线）。
 * - 约束：`bounds`（待在区域内）、`limits`（尺寸与缩放上下限）、`collide`（不与障碍物重叠）。
 *
 * 插件只读写状态，不引用 DOM，可用于任意 `Tracker`；能力组合里的顺序为
 * `grid → magnet → 用户插件 → bounds → limits → collide`。
 */

export * from "./angle";
export * from "./bounds";
export * from "./collide";
export * from "./grid";
export * from "./limits";
export * from "./magnet";

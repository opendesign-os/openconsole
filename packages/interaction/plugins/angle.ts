/**
 * @file 角度吸附插件：把旋转角取整到固定步长。
 *
 * 只在动作允许旋转时生效，补转绕 `context.anchor`（容器空间）进行，平移与缩放分量不变。
 */

import { plane } from "@openconsole/matrix";

import type { Plugin } from "../core";

/**
 * 创建角度吸附插件：能旋转时把矩阵的旋转角取整到 `step` 的整数倍。
 *
 * 当前角度取自矩阵线性部分 `atan2(b, a)`（容器空间里相对 x 轴的角度，屏幕上顺时针为正），
 * 四舍五入到最近的 `step` 倍数；与目标角度的差值绕 `anchor` 左乘补转，旋转中心因此不跳。
 * 动作不允许旋转（`freedom.rotate` 为假）时不做任何处理。
 *
 * @param step 吸附步长，单位为弧度，须为有限正数。
 * @returns 只实现 `onMove` 的插件。
 * @throws {RangeError} `step` 不是有限正数时。
 * @example
 * bind(node, {
 *   action: transform({ rotate: true }),
 *   plugins: [angle(Math.PI / 12)], // 每 15° 一格
 * });
 */
export function angle(step: number): Plugin {
  if (!(Number.isFinite(step) && step > 0)) {
    throw new RangeError(`expected a positive step, received ${step}`);
  }
  return {
    /** 求出离当前角度最近的步长倍数，绕锚点补转差值。 */
    onMove: ({ state, anchor, action: { freedom } }) => {
      if (!freedom.rotate) return undefined;
      const [a, b] = state.matrix;
      const current = Math.atan2(b, a);
      const target = Math.round(current / step) * step;
      return {
        ...state,
        matrix: plane.multiply(
          plane.around(anchor, plane.rotate(target - current)),
          state.matrix,
        ),
      };
    },
  };
}

/**
 * @file 网格吸附插件：把平移或移动边的尺寸吸附到固定步长。
 *
 * 吸附在容器空间进行：平移时吸附矩阵的平移分量（局部原点落在网格点上），
 * 调整尺寸时吸附移动边所在轴的宽或高。
 */

import { resizes, type Plugin } from "../core";

/**
 * 创建网格吸附插件，按动作的自由度决定吸附什么。
 *
 * - 调整尺寸（`freedom.edges` 有移动边）：左右边移动时吸附宽度，上下边移动时吸附高度；
 *   对边钉住由流水线最后的再投影完成。
 * - 能平移：吸附矩阵的平移分量 `e`、`f`，即局部原点在容器空间里的位置。
 * - 只旋转或只缩放：不处理。
 *
 * @param step 网格步长，单位为容器空间像素，须为有限正数。
 * @returns 只实现 `onMove` 的插件。
 * @throws {RangeError} `step` 不是有限正数时。
 * @example
 * bind(node, { action: transform({ translate: true }), plugins: [grid(20)] });
 */
export function grid(step: number): Plugin {
  if (!(Number.isFinite(step) && step > 0)) {
    throw new RangeError(`expected a positive step, received ${step}`);
  }
  const snap = (value: number) => Math.round(value / step) * step;
  return {
    onMove: ({ state, action: { freedom } }) => {
      if (resizes(freedom)) {
        const { edges } = freedom;
        const { width, height } = state.size;
        return {
          ...state,
          size: {
            width: edges.left || edges.right ? snap(width) : width,
            height: edges.top || edges.bottom ? snap(height) : height,
          },
        };
      }
      if (!freedom.translate) return undefined;
      const [a, b, c, d, e, f] = state.matrix;
      return { ...state, matrix: [a, b, c, d, snap(e), snap(f)] };
    },
  };
}

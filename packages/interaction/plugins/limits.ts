/**
 * @file 上下限插件：夹住调整尺寸时的宽高，以及缩放时的倍数。
 *
 * 能力组合里排在 `bounds` 之后，二者冲突时以上下限为准。
 */

import { plane } from "@openconsole/matrix";

import { resizes, type Plugin } from "../core";
import type { Range } from "../model";

/** {@link limits} 的范围配置；省略的项不限制。 */
export interface Limits {
  /** 宽度范围，边框盒宽度（局部空间像素）；只在左边或右边移动时生效。 */
  readonly width?: Range;
  /** 高度范围，边框盒高度（局部空间像素）；只在上边或下边移动时生效。 */
  readonly height?: Range;
  /** 等比缩放倍数范围，取自矩阵线性部分；只在动作允许缩放时生效。 */
  readonly scale?: Range;
}

/**
 * 把数值夹进范围，缺少的一端不限制。
 *
 * @param value 原值。
 * @param range 范围；缺省为 `{}`，即不限制。
 * @returns 夹进 `[min, max]` 后的值；`min` 大于 `max` 时结果为 `max`。
 */
const clamp = (value: number, range: Range = {}): number =>
  Math.min(Math.max(value, range.min ?? -Infinity), range.max ?? Infinity);

/**
 * 创建上下限插件，按自由度分别处理尺寸与缩放。
 *
 * - 调整尺寸：只夹移动边所在轴的宽或高；对边钉住由流水线最后的再投影完成，节点不会离开钉住的边。
 * - 能缩放：当前倍数取矩阵第一列的长度 `hypot(a, b)`，即节点相对容器空间的缩放（不含祖先的变换），
 *   超出范围时绕 `anchor`（容器空间）补缩放；倍数为 0 时不处理。
 * - 两者都不涉及时原样返回候选。
 *
 * @param options 宽、高与缩放倍数的范围。
 * @returns 只实现 `onMove` 的插件。
 * @example
 * bind(node, {
 *   action: resize({ handle: { x: 1, y: 1 } }),
 *   plugins: [limits({ width: { min: 40, max: 400 } })],
 * });
 */
export function limits(options: Limits): Plugin {
  return {
    /** 先夹移动轴的宽高，再按需绕锚点把缩放倍数补到范围内。 */
    onMove: ({ state, anchor, action: { freedom } }) => {
      let next = state;
      if (resizes(freedom)) {
        const { edges } = freedom;
        const { width, height } = state.size;
        next = {
          ...next,
          size: {
            width:
              edges.left || edges.right ? clamp(width, options.width) : width,
            height:
              edges.top || edges.bottom
                ? clamp(height, options.height)
                : height,
          },
        };
      }
      if (freedom.scale && options.scale) {
        const [a, b] = next.matrix;
        const current = Math.hypot(a, b);
        const target = clamp(current, options.scale);
        if (current > 0 && target !== current) {
          next = {
            ...next,
            matrix: plane.multiply(
              plane.around(anchor, plane.scale(target / current)),
              next.matrix,
            ),
          };
        }
      }
      return next;
    },
  };
}

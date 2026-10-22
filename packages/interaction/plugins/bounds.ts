/**
 * @file 范围插件：让节点的包围盒待在给定区域里。
 *
 * 区域与状态同在容器空间，区域在会话开始时测量一次。按自由度处理：能平移时把包围盒推回，
 * 调整尺寸时沿钉住方向求可行的宽高，只旋转或缩放时退回上一步。
 */

import { plane, type Point } from "@openconsole/matrix";

import { pin, resizes, type Edges, type Plugin } from "../core";
import { corners, extent, type Bounds, type State } from "../model";

/** 会话开始前的区域：不限制。 */
const open: Bounds = {
  left: -Infinity,
  top: -Infinity,
  right: Infinity,
  bottom: Infinity,
};

/**
 * 判断包围盒是否完全在区域内，贴边也算在内。
 *
 * @param box 被检查的包围盒。
 * @param region 区域。
 * @returns 四条边都不越出区域时为 `true`。
 */
const inside = (box: Bounds, region: Bounds): boolean =>
  box.left >= region.left &&
  box.top >= region.top &&
  box.right <= region.right &&
  box.bottom <= region.bottom;

/**
 * 一维推回量：让 `[low, high]` 落进 `[min, max]`；放不下时让起点贴住 `min`。
 *
 * @param low 区间起点。
 * @param high 区间终点。
 * @param min 区域起点。
 * @param max 区域终点。
 * @returns 应加到区间上的位移；已在区域内时为 0。
 */
function shift(low: number, high: number, min: number, max: number): number {
  if (high - low > max - min || low < min) return min - low;
  if (high > max) return max - high;
  return 0;
}

/**
 * 求某一维尺寸在区域内的可行值。
 *
 * 钉住是仿射的，所以四个角的每个坐标都是尺寸 `v` 的一次函数 `base + slope·v`：`at(0)` 给出 `base`，
 * `at(1) − at(0)` 给出 `slope`。逐个坐标解出 `min ≤ base + slope·v ≤ max` 的区间并取交集
 * （从 `[0, ∞)` 开始），再把 `value` 夹进去；交集为空时原样返回。
 *
 * @param at 由尺寸求四个角（容器空间）的函数。
 * @param value 候选尺寸。
 * @param region 容器空间里的区域。
 * @returns 夹进可行区间后的尺寸。
 */
function limit(
  at: (value: number) => readonly Point<2>[],
  value: number,
  region: Bounds,
): number {
  const zero = at(0);
  const one = at(1);
  let low = 0;
  let high = Infinity;
  zero.forEach((start, index) => {
    const end = one[index] ?? start;
    const lines = [
      {
        base: start.x,
        slope: end.x - start.x,
        min: region.left,
        max: region.right,
      },
      {
        base: start.y,
        slope: end.y - start.y,
        min: region.top,
        max: region.bottom,
      },
    ];
    for (const { base, slope, min, max } of lines) {
      if (slope > 0) {
        low = Math.max(low, (min - base) / slope);
        high = Math.min(high, (max - base) / slope);
      } else if (slope < 0) {
        low = Math.max(low, (max - base) / slope);
        high = Math.min(high, (min - base) / slope);
      }
    }
  });
  return low > high ? value : Math.min(Math.max(value, low), high);
}

/**
 * 调整尺寸时把宽、高依次夹到区域允许的范围：先宽后高，求高时用已夹好的宽。
 * 四个角按会话起点 `origin` 钉住对边计算，与动作的钉住方式一致。
 *
 * @param state 候选状态。
 * @param origin 会话起点。
 * @param edges 移动的边。
 * @param region 容器空间里的区域。
 * @returns 只改了尺寸的状态；矩阵由流水线最后的再投影重新钉住。
 */
function fit(state: State, origin: State, edges: Edges, region: Bounds): State {
  /** 给定宽高时，按起点钉住对边后的四个角（容器空间）。 */
  const shape = (width: number, height: number) => {
    const size = { width, height };
    return corners({ ...state, size, matrix: pin(origin, size, edges) });
  };
  const width =
    edges.left || edges.right
      ? limit(
          (value) => shape(value, state.size.height),
          state.size.width,
          region,
        )
      : state.size.width;
  const height =
    edges.top || edges.bottom
      ? limit((value) => shape(width, value), state.size.height, region)
      : state.size.height;
  return { ...state, size: { width, height } };
}

/**
 * 创建范围插件：节点的包围盒（容器空间里四个角的轴对齐外接矩形）须待在 `measure()` 返回的区域内。
 *
 * - 包围盒已在区域内：不处理。
 * - 调整尺寸：会话起点在区域内时，沿钉住方向把宽高夹到可行范围；起点本就越界时不处理，避免跳变。
 * - 能平移：把包围盒平移回区域；包围盒比区域还大时贴住左上。
 * - 只旋转或只缩放：退回上一次提交的状态。
 *
 * 区域是轴对齐的，按包围盒判断与按四个角判断等价，所以旋转后的节点同样能贴着区域的边。
 *
 * @param measure 返回区域（容器空间）的函数，在每次会话开始时调用一次；DOM 侧可用 `region(container, node)`。
 * @returns 实现 `onStart` 与 `onMove` 的插件。
 * @example
 * bind(node, {
 *   action: transform({ translate: true }),
 *   plugins: [bounds(() => ({ left: 0, top: 0, right: 800, bottom: 600 }))],
 * });
 */
export function bounds(measure: () => Bounds): Plugin {
  /** 本次会话的区域；第一次会话开始前不限制。 */
  let region = open;
  return {
    /** 量出本次会话的区域。 */
    onStart: () => {
      region = measure();
    },
    /** 越界时按自由度推回、夹尺寸或退回上一步。 */
    onMove: ({ state, origin, previous, action: { freedom } }) => {
      const box = extent(corners(state));
      if (inside(box, region)) return undefined;
      if (resizes(freedom)) {
        return inside(extent(corners(origin)), region)
          ? fit(state, origin, freedom.edges, region)
          : undefined;
      }
      if (!freedom.translate) return previous;
      return {
        ...state,
        matrix: plane.multiply(
          plane.translate(
            shift(box.left, box.right, region.left, region.right),
            shift(box.top, box.bottom, region.top, region.bottom),
          ),
          state.matrix,
        ),
      };
    },
  };
}

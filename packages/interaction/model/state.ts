/**
 * @file 统一状态：所有能力、所有插件读写的同一种状态，以及合并与取点的纯函数。
 *
 * 矩阵把局部空间（节点边框盒，左上为原点）映射到容器空间（offsetParent 内边距盒，左上为原点）。
 */

import { plane, type Matrix, type Point } from "@openconsole/matrix";

import type { Polygon } from "./geometry";

/** 边框盒宽高，取小数值。 */
export interface Size {
  /** 宽度（像素）。 */
  readonly width: number;
  /** 高度（像素）。 */
  readonly height: number;
}

/**
 * 节点的几何与位置状态。
 *
 * 平移、旋转、等比缩放都在 `matrix` 里；非等比的变化由 `size` 表达，排序位置由 `index` 表达。
 */
export interface State {
  /** 局部空间 → 容器空间的二维仿射矩阵。 */
  readonly matrix: Matrix<2, "affine">;
  /** 边框盒尺寸。 */
  readonly size: Size;
  /** 在所属列表中的位置；只有可排序的节点才有。 */
  readonly index?: number;
}

/** 状态的局部写入：给出的字段替换原值，未给出的保持不变。 */
export interface Patch {
  /** 新矩阵。 */
  readonly matrix?: Matrix<2, "affine"> | undefined;
  /** 新尺寸。 */
  readonly size?: Size | undefined;
  /** 新序号。 */
  readonly index?: number | undefined;
}

/**
 * 把局部写入合并进状态。
 *
 * 值为 `undefined` 的字段视为未给出；`index` 只在给出时写入，原状态没有序号时也不会凭空出现。
 *
 * @param state 原状态。
 * @param patch 局部写入。
 * @returns 新状态；`patch` 不含任何字段时原样返回 `state`，调用方据此判断有无写入。
 * @example
 * merge(state, {}) === state; // true：空写入不产生新对象
 * merge(state, { size: { width: 80, height: 40 } }); // 只换尺寸，矩阵与序号保持不变
 */
export function merge(state: State, { matrix, size, index }: Patch): State {
  if (!matrix && !size && index === undefined) return state;
  return {
    ...state,
    matrix: matrix ?? state.matrix,
    size: size ?? state.size,
    ...(index === undefined ? {} : { index }),
  };
}

/**
 * 状态的四个角在容器空间里的位置。
 *
 * 节点旋转、斜切后四个角不再构成轴对齐矩形，需要包围盒时再交给 `extent`。
 *
 * @param state 状态。
 * @returns 依次为局部空间的左上、右上、右下、左下角映射后的四边形。
 * @example
 * corners({ matrix: plane.translate(10, 20), size: { width: 80, height: 40 } });
 * // [{ x: 10, y: 20 }, { x: 90, y: 20 }, { x: 90, y: 60 }, { x: 10, y: 60 }]
 */
export function corners(state: State): Polygon {
  const { width, height } = state.size;
  const points: Polygon = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  return points.map((point) => plane.apply(state.matrix, point));
}

/**
 * 状态的边框盒中心在容器空间里的位置。
 *
 * 与 `centroid(corners(state))` 相同，但只变换一个点。
 *
 * @param state 状态。
 * @returns 中心点。
 * @example
 * center({ matrix: plane.translate(10, 20), size: { width: 80, height: 40 } }); // { x: 50, y: 40 }
 */
export const center = (state: State): Point<2> =>
  plane.apply(state.matrix, {
    x: state.size.width / 2,
    y: state.size.height / 2,
  });

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
 * @param state 原状态。
 * @param patch 局部写入。
 * @returns 新状态；`patch` 不含任何字段时原样返回 `state`，调用方据此判断有无写入。
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
 * @param state 状态。
 * @returns 依次为左上、右上、右下、左下的四边形。
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
 * @param state 状态。
 * @returns 中心点。
 */
export const center = (state: State): Point<2> =>
  plane.apply(state.matrix, {
    x: state.size.width / 2,
    y: state.size.height / 2,
  });

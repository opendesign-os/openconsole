import { plane, type Matrix, type Point } from "@openconsole/matrix";

import type { Polygon } from "./geometry";

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface State {
  readonly matrix: Matrix<2, "affine">;
  readonly size: Size;
  readonly index?: number;
}

export interface Patch {
  readonly matrix?: Matrix<2, "affine"> | undefined;
  readonly size?: Size | undefined;
  readonly index?: number | undefined;
}

export function merge(state: State, { matrix, size, index }: Patch): State {
  if (!matrix && !size && index === undefined) return state;
  return {
    ...state,
    matrix: matrix ?? state.matrix,
    size: size ?? state.size,
    ...(index === undefined ? {} : { index }),
  };
}

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

export const center = (state: State): Point<2> =>
  plane.apply(state.matrix, {
    x: state.size.width / 2,
    y: state.size.height / 2,
  });

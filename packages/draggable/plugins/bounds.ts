import { space } from "@openconsole/matrix";

import type { Plugin } from "../core/tracker";

export interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high);

export function bounds(measure: () => Bounds): Plugin {
  let limits: Bounds = {
    left: -Infinity,
    top: -Infinity,
    right: Infinity,
    bottom: Infinity,
  };
  return {
    onStart: () => {
      limits = measure();
    },
    onMove: ({ matrix }) =>
      space.multiply(
        space.translate(
          clamp(matrix[12], limits.left, limits.right) - matrix[12],
          clamp(matrix[13], limits.top, limits.bottom) - matrix[13],
          0,
        ),
        matrix,
      ),
  };
}

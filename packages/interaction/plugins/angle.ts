import { plane } from "@openconsole/matrix";

import type { Plugin } from "../core";

export function angle(step: number): Plugin {
  if (!(Number.isFinite(step) && step > 0)) {
    throw new RangeError(`expected a positive step, received ${step}`);
  }
  return {
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

import { plane } from "@openconsole/matrix";

import { resizes, type Plugin } from "../core";
import type { Range } from "../model";

export interface Limits {
  readonly width?: Range;
  readonly height?: Range;
  readonly scale?: Range;
}

const clamp = (value: number, range: Range = {}): number =>
  Math.min(Math.max(value, range.min ?? -Infinity), range.max ?? Infinity);

export function limits(options: Limits): Plugin {
  return {
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

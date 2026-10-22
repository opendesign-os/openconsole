import { plane, type Point } from "@openconsole/matrix";

import { pin, resizes, type Edges, type Plugin } from "../core";
import { corners, extent, type Bounds, type State } from "../model";

const open: Bounds = {
  left: -Infinity,
  top: -Infinity,
  right: Infinity,
  bottom: Infinity,
};

const inside = (box: Bounds, region: Bounds): boolean =>
  box.left >= region.left &&
  box.top >= region.top &&
  box.right <= region.right &&
  box.bottom <= region.bottom;

function shift(low: number, high: number, min: number, max: number): number {
  if (high - low > max - min || low < min) return min - low;
  if (high > max) return max - high;
  return 0;
}

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

function fit(state: State, origin: State, edges: Edges, region: Bounds): State {
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

export function bounds(measure: () => Bounds): Plugin {
  let region = open;
  return {
    onStart: () => {
      region = measure();
    },
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

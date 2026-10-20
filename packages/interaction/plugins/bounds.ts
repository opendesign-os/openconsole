import { plane, type Point } from "@openconsole/matrix";

import {
  corners,
  extent,
  pin,
  resizes,
  type Bounds,
  type Edges,
  type Plugin,
  type State,
} from "../core";

const open: Bounds = {
  left: -Infinity,
  top: -Infinity,
  right: Infinity,
  bottom: Infinity,
};

const inside = (box: Bounds, area: Bounds): boolean =>
  box.left >= area.left &&
  box.top >= area.top &&
  box.right <= area.right &&
  box.bottom <= area.bottom;

function shift(low: number, high: number, min: number, max: number): number {
  if (high - low > max - min || low < min) return min - low;
  if (high > max) return max - high;
  return 0;
}

function limit(
  at: (value: number) => readonly Point<2>[],
  value: number,
  area: Bounds,
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
        min: area.left,
        max: area.right,
      },
      {
        base: start.y,
        slope: end.y - start.y,
        min: area.top,
        max: area.bottom,
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

function fit(state: State, origin: State, edges: Edges, area: Bounds): State {
  const shape = (width: number, height: number) => {
    const size = { width, height };
    return corners({ ...state, size, matrix: pin(origin, size, edges) });
  };
  const width =
    edges.left || edges.right
      ? limit(
          (value) => shape(value, state.size.height),
          state.size.width,
          area,
        )
      : state.size.width;
  const height =
    edges.top || edges.bottom
      ? limit((value) => shape(width, value), state.size.height, area)
      : state.size.height;
  return { ...state, size: { width, height } };
}

export function bounds(measure: () => Bounds): Plugin {
  let area = open;
  return {
    onStart: () => {
      area = measure();
    },
    onMove: ({ state, origin, previous, action: { freedom } }) => {
      const box = extent(state);
      if (inside(box, area)) return undefined;
      if (resizes(freedom)) {
        return inside(extent(origin), area)
          ? fit(state, origin, freedom.edges, area)
          : undefined;
      }
      if (!freedom.translate) return previous;
      return {
        ...state,
        matrix: plane.multiply(
          plane.translate(
            shift(box.left, box.right, area.left, area.right),
            shift(box.top, box.bottom, area.top, area.bottom),
          ),
          state.matrix,
        ),
      };
    },
  };
}

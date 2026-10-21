import type { Point } from "@openconsole/matrix";

import type { Bounds } from "./state";

export type Slot = (point: Point<2>, boxes: readonly Bounds[]) => number;

export interface Plan {
  readonly before: readonly number[];
  readonly after: readonly number[];
}

export const closest: Slot = (point, boxes) => {
  let index = -1;
  let nearest = Infinity;
  boxes.forEach((bounds, position) => {
    const distance = Math.hypot(
      (bounds.left + bounds.right) / 2 - point.x,
      (bounds.top + bounds.bottom) / 2 - point.y,
    );
    if (distance < nearest) {
      nearest = distance;
      index = position;
    }
  });
  return index;
};

const span = (from: number, to: number): number[] =>
  Array.from({ length: Math.max(0, to - from) }, (_, offset) => from + offset);

export function arrange(current: number, target: number): Plan {
  return target > current
    ? { before: span(current + 1, target + 1), after: [] }
    : { before: [], after: span(target, current) };
}

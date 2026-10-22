import type { Point } from "@openconsole/matrix";

export interface Span {
  readonly min: number;
  readonly max: number;
}

export type Range = Partial<Span>;

export interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export type Polygon = readonly Point<2>[];

export const epsilon = 1e-6;

export interface Guide {
  readonly kind: "align" | "gap";
  readonly from: Point<2>;
  readonly to: Point<2>;
}

const side = (start: Point<2>, end: Point<2>, point: Point<2>): number =>
  (end.x - start.x) * (point.y - start.y) -
  (end.y - start.y) * (point.x - start.x);

const edges = (polygon: Polygon): [Point<2>, Point<2>][] =>
  polygon.map((start, index) => [
    start,
    polygon[(index + 1) % polygon.length] ?? start,
  ]);

function signed(polygon: Polygon): number {
  let sum = 0;
  for (const [start, end] of edges(polygon)) {
    sum += start.x * end.y - end.x * start.y;
  }
  return sum / 2;
}

function crossing(
  from: Point<2>,
  to: Point<2>,
  start: Point<2>,
  end: Point<2>,
): Point<2> {
  const before = side(start, end, from);
  const ratio = before / (before - side(start, end, to));
  return {
    x: from.x + (to.x - from.x) * ratio,
    y: from.y + (to.y - from.y) * ratio,
  };
}

export function extent(polygon: Polygon): Bounds {
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

export function centroid(points: Polygon): Point<2> {
  const sum = points.reduce(
    (total, point) => ({ x: total.x + point.x, y: total.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
}

export const area = (polygon: Polygon): number => Math.abs(signed(polygon));

export function contains(polygon: Polygon, point: Point<2>): boolean {
  let winding = 0;
  for (const [start, end] of edges(polygon)) {
    const sign = Math.sign(side(start, end, point));
    if (sign === 0) continue;
    if (winding === 0) winding = sign;
    else if (sign !== winding) return false;
  }
  return true;
}

export function intersect(subject: Polygon, clip: Polygon): Polygon {
  const winding = Math.sign(signed(clip));
  let result = subject;
  for (const [start, end] of edges(clip)) {
    const inside = (point: Point<2>) => side(start, end, point) * winding >= 0;
    const kept: Point<2>[] = [];
    for (const [from, to] of edges(result)) {
      if (inside(to)) {
        if (!inside(from)) kept.push(crossing(from, to, start, end));
        kept.push(to);
      } else if (inside(from)) {
        kept.push(crossing(from, to, start, end));
      }
    }
    result = kept;
    if (result.length === 0) break;
  }
  return result;
}

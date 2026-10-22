import { plane, type Point } from "@openconsole/matrix";

import { pin, resizes, type Context, type Edges, type Plugin } from "../core";
import {
  corners,
  epsilon,
  type Polygon,
  type Span,
  type State,
} from "../model";

interface Hit {
  readonly time: number;
  readonly normal: Point<2>;
}

const dot = (left: Point<2>, right: Point<2>): number =>
  left.x * right.x + left.y * right.y;

const times = (vector: Point<2>, factor: number): Point<2> => ({
  x: vector.x * factor,
  y: vector.y * factor,
});

function tangent(vector: Point<2>, normal: Point<2>): Point<2> {
  const depth = dot(vector, normal);
  return { x: vector.x - depth * normal.x, y: vector.y - depth * normal.y };
}

const mix = (from: number, to: number, ratio: number): number =>
  from + (to - from) * ratio;

function normals(polygon: Polygon): Point<2>[] {
  return polygon.flatMap((start, index) => {
    const end = polygon[(index + 1) % polygon.length] ?? start;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length === 0) return [];
    return [{ x: (end.y - start.y) / length, y: (start.x - end.x) / length }];
  });
}

const axes = (shape: Polygon, obstacle: Polygon): Point<2>[] => [
  ...normals(shape),
  ...normals(obstacle),
];

function project(polygon: Polygon, axis: Point<2>): Span {
  const values = polygon.map((point) => dot(point, axis));
  return { min: Math.min(...values), max: Math.max(...values) };
}

const separated = (moving: Span, fixed: Span): boolean =>
  moving.max <= fixed.min + epsilon || fixed.max <= moving.min + epsilon;

function overlaps(shape: Polygon, obstacle: Polygon): boolean {
  const directions = axes(shape, obstacle);
  return (
    directions.length > 0 &&
    directions.every(
      (axis) => !separated(project(shape, axis), project(obstacle, axis)),
    )
  );
}

function sweep(
  shape: Polygon,
  motion: Point<2>,
  obstacle: Polygon,
): Hit | undefined {
  let enter = -Infinity;
  let exit = Infinity;
  let normal: Point<2> | undefined;
  for (const axis of axes(shape, obstacle)) {
    const moving = project(shape, axis);
    const fixed = project(obstacle, axis);
    const speed = dot(motion, axis);
    if (Math.abs(speed) < epsilon) {
      if (separated(moving, fixed)) return undefined;
      continue;
    }
    const near = speed > 0 ? fixed.min - moving.max : fixed.max - moving.min;
    const far = speed > 0 ? fixed.max - moving.min : fixed.min - moving.max;
    if (near / speed > enter) {
      enter = near / speed;
      normal = speed > 0 ? times(axis, -1) : axis;
    }
    exit = Math.min(exit, far / speed);
  }
  if (!normal || enter > exit || enter >= 1 || exit <= 0) return undefined;
  return { time: Math.max(0, enter), normal };
}

function earliest(
  shape: Polygon,
  motion: Point<2>,
  obstacles: readonly Polygon[],
): Hit | undefined {
  let first: Hit | undefined;
  for (const obstacle of obstacles) {
    const hit = sweep(shape, motion, obstacle);
    if (hit && (!first || hit.time < first.time)) first = hit;
  }
  return first;
}

function translation(from: State, to: State): Point<2> | undefined {
  const turned = !plane.equals(
    plane.linear(from.matrix),
    plane.linear(to.matrix),
    epsilon,
  );
  const resized =
    from.size.width !== to.size.width || from.size.height !== to.size.height;
  if (turned || resized) return undefined;
  return { x: to.matrix[4] - from.matrix[4], y: to.matrix[5] - from.matrix[5] };
}

function slide(
  state: State,
  motion: Point<2>,
  obstacles: readonly Polygon[],
): State {
  let current = state;
  let rest = motion;
  for (let step = 0; step < 3; step += 1) {
    if (Math.hypot(rest.x, rest.y) <= epsilon) break;
    const hit = earliest(corners(current), rest, obstacles);
    const time = hit?.time ?? 1;
    const travel = times(rest, time);
    current = {
      ...current,
      matrix: plane.multiply(
        plane.translate(travel.x, travel.y),
        current.matrix,
      ),
    };
    if (!hit) break;
    rest = tangent(times(rest, 1 - time), hit.normal);
  }
  return current;
}

type Path = (ratio: number) => State;

function grow(from: State, to: State, origin: State, edges: Edges): Path {
  return (ratio) => {
    const size = {
      width: mix(from.size.width, to.size.width, ratio),
      height: mix(from.size.height, to.size.height, ratio),
    };
    return { ...to, size, matrix: pin(origin, size, edges) };
  };
}

function turn(from: State, to: State): Path | undefined {
  const inverse = plane.invert(from.matrix);
  if (!inverse) return undefined;
  const [a, b, c, d, e, f] = plane.multiply(to.matrix, inverse);
  if (Math.abs(a - d) > epsilon || Math.abs(b + c) > epsilon) return undefined;
  const angle = Math.atan2(b, a);
  const factor = Math.hypot(a, b);
  const determinant = (1 - a) * (1 - d) - b * c;
  const pivot = {
    x: ((1 - d) * e + c * f) / determinant,
    y: ((1 - a) * f + b * e) / determinant,
  };
  return (ratio) => ({
    ...to,
    matrix: plane.multiply(
      plane.around(
        pivot,
        plane.multiply(
          plane.rotate(angle * ratio),
          plane.scale(factor ** ratio),
        ),
      ),
      from.matrix,
    ),
  });
}

function advance(path: Path, blocked: (state: State) => boolean): State {
  let low = 0;
  let high = 1;
  for (let step = 0; step < 32; step += 1) {
    const middle = (low + high) / 2;
    if (blocked(path(middle))) high = middle;
    else low = middle;
  }
  return path(low);
}

export function collide(
  targets: (context: Context) => Iterable<Polygon>,
): Plugin {
  let obstacles: Polygon[] = [];
  const blocked = (state: State) => {
    const shape = corners(state);
    return obstacles.some((obstacle) => overlaps(shape, obstacle));
  };
  return {
    onStart: (context) => {
      const shape = corners(context.state);
      obstacles = [...targets(context)].filter(
        (obstacle) => !overlaps(shape, obstacle),
      );
    },
    onMove: ({ state, previous, origin, action: { freedom } }) => {
      if (obstacles.length === 0) return undefined;
      const motion = translation(previous, state);
      if (motion) {
        return slide({ ...state, matrix: previous.matrix }, motion, obstacles);
      }
      if (!blocked(state)) return undefined;
      const path = resizes(freedom)
        ? grow(previous, state, origin, freedom.edges)
        : turn(previous, state);
      if (path) return advance(path, blocked);
      return { ...state, matrix: previous.matrix, size: previous.size };
    },
  };
}

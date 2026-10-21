import { plane, type Matrix, type Point } from "@openconsole/matrix";

import type { Size, State } from "../model";

export interface Edges {
  readonly left: boolean;
  readonly top: boolean;
  readonly right: boolean;
  readonly bottom: boolean;
}

export interface Freedom {
  readonly translate: boolean;
  readonly rotate: boolean;
  readonly scale: boolean;
  readonly edges: Edges;
  readonly pivot?: Point<2>;
}

export interface Action {
  readonly freedom: Freedom;
  solve(
    origin: State,
    from: readonly Point<2>[],
    to: readonly Point<2>[],
  ): State;
}

export interface Handle {
  readonly x: -1 | 0 | 1;
  readonly y: -1 | 0 | 1;
}

const still: Edges = { left: false, top: false, right: false, bottom: false };

export const resizes = ({ edges }: Freedom): boolean =>
  edges.left || edges.top || edges.right || edges.bottom;

export function centroid(points: readonly Point<2>[]): Point<2> {
  const sum = points.reduce(
    (total, point) => ({ x: total.x + point.x, y: total.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
}

export function anchor(
  freedom: Freedom,
  state: State,
  points: readonly Point<2>[],
): Point<2> {
  if (freedom.translate && points.length > 0) return centroid(points);
  const { width, height } = state.size;
  return plane.apply(
    state.matrix,
    freedom.pivot ?? { x: width / 2, y: height / 2 },
  );
}

export function pin(
  origin: State,
  size: Size,
  edges: Edges,
): Matrix<2, "affine"> {
  const share = (low: boolean, high: boolean) => (low ? (high ? 0.5 : 1) : 0);
  return plane.multiply(
    origin.matrix,
    plane.translate(
      share(edges.left, edges.right) * (origin.size.width - size.width),
      share(edges.top, edges.bottom) * (origin.size.height - size.height),
    ),
  );
}

function project(
  motion: Matrix<2, "affine">,
  point: Point<2>,
  freedom: Freedom,
): Matrix<2, "affine"> {
  const [a, b] = motion;
  const target = freedom.translate ? plane.apply(motion, point) : point;
  return plane.multiply(
    plane.translate(target.x, target.y),
    plane.rotate(freedom.rotate ? Math.atan2(b, a) : 0),
    plane.scale(freedom.scale ? Math.hypot(a, b) : 1),
    plane.translate(-point.x, -point.y),
  );
}

export function transform(
  options: {
    readonly translate?: boolean;
    readonly rotate?: boolean;
    readonly scale?: boolean;
    readonly pivot?: Point<2>;
  } = {},
): Action {
  const { translate = false, rotate = false, scale = false, pivot } = options;
  const freedom: Freedom = {
    translate,
    rotate,
    scale,
    edges: still,
    ...(pivot ? { pivot } : {}),
  };
  return {
    freedom,
    solve(origin, from, to) {
      const [first, second] = from;
      const [last, next] = to;
      if (!first || !last || from.length !== to.length) return origin;
      const point = anchor(freedom, origin, from);
      const motion =
        second && next
          ? plane.pinch([first, second], [last, next])
          : translate
            ? plane.translate(last.x - first.x, last.y - first.y)
            : plane.pinch([point, first], [point, last]);
      return {
        ...origin,
        matrix: plane.multiply(project(motion, point, freedom), origin.matrix),
      };
    },
  };
}

export function resize(options: {
  readonly handle: Handle;
  readonly symmetric?: boolean;
}): Action {
  const { handle, symmetric = false } = options;
  const both = (side: -1 | 0 | 1) => symmetric && side !== 0;
  const edges: Edges = {
    left: handle.x === -1 || both(handle.x),
    top: handle.y === -1 || both(handle.y),
    right: handle.x === 1 || both(handle.x),
    bottom: handle.y === 1 || both(handle.y),
  };
  const factor = symmetric ? 2 : 1;
  return {
    freedom: { translate: false, rotate: false, scale: false, edges },
    solve(origin, from, to) {
      const [first] = from;
      const [last] = to;
      const inverse = plane.invert(plane.linear(origin.matrix));
      if (!first || !last || !inverse) return origin;
      const delta = plane.apply(inverse, {
        x: last.x - first.x,
        y: last.y - first.y,
      });
      const size = {
        width: Math.max(0, origin.size.width + handle.x * factor * delta.x),
        height: Math.max(0, origin.size.height + handle.y * factor * delta.y),
      };
      return { ...origin, size, matrix: pin(origin, size, edges) };
    },
  };
}

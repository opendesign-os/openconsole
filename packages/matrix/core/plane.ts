import type * as types from "./types";
import { numbers, rounded } from "./values";

type Matrix = types.Matrix<2, "affine">;
type Point = types.Point<2>;

export interface Parts {
  readonly translation: Point;
  readonly scale: Point;
  readonly rotation: number;
  readonly skew: number;
}

export const identity: Matrix = [1, 0, 0, 1, 0, 0];

export function from(values: ArrayLike<number>): Matrix {
  if (values.length !== 6) {
    throw new RangeError(`expected 6 values, received ${values.length}`);
  }
  return [
    values[0]!,
    values[1]!,
    values[2]!,
    values[3]!,
    values[4]!,
    values[5]!,
  ];
}

export const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];

export const scale = (x: number, y = x): Matrix => [x, 0, 0, y, 0, 0];

export function rotate(angle: number): Matrix {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [cosine, sine, -sine, cosine, 0, 0];
}

export function skew(x: number, y = 0): Matrix {
  return [1, Math.tan(y), Math.tan(x), 1, 0, 0];
}

export const basis = (origin: Point, x: Point, y: Point): Matrix => [
  x.x - origin.x,
  x.y - origin.y,
  y.x - origin.x,
  y.y - origin.y,
  origin.x,
  origin.y,
];

export function pinch(
  from: readonly [Point, Point],
  to: readonly [Point, Point],
): Matrix {
  const [anchor, reach] = from;
  const [landing, target] = to;
  const span = { x: reach.x - anchor.x, y: reach.y - anchor.y };
  const extent = span.x * span.x + span.y * span.y;
  if (extent === 0) {
    return translate(landing.x - anchor.x, landing.y - anchor.y);
  }

  const shift = { x: target.x - landing.x, y: target.y - landing.y };
  const cosine = (span.x * shift.x + span.y * shift.y) / extent;
  const sine = (span.x * shift.y - span.y * shift.x) / extent;
  return [
    cosine,
    sine,
    -sine,
    cosine,
    landing.x - (cosine * anchor.x - sine * anchor.y),
    landing.y - (sine * anchor.x + cosine * anchor.y),
  ];
}

function product(outer: Matrix, inner: Matrix): Matrix {
  const [a, b, c, d, e, f] = outer;
  return [
    a * inner[0] + c * inner[1],
    b * inner[0] + d * inner[1],
    a * inner[2] + c * inner[3],
    b * inner[2] + d * inner[3],
    a * inner[4] + c * inner[5] + e,
    b * inner[4] + d * inner[5] + f,
  ];
}

export const multiply = (...matrices: readonly Matrix[]): Matrix =>
  matrices.reduce(product, identity);

export function invert([a, b, c, d, e, f]: Matrix): Matrix | undefined {
  const determinant = a * d - b * c;
  if (determinant === 0) return undefined;
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ];
}

export const linear = ([a, b, c, d]: Matrix): Matrix => [a, b, c, d, 0, 0];

export const around = (pivot: Point, matrix: Matrix): Matrix =>
  multiply(translate(pivot.x, pivot.y), matrix, translate(-pivot.x, -pivot.y));

export function apply(matrix: Matrix, point: Point): Point;
export function apply(
  matrix: Matrix,
  points: Float64Array,
  target?: Float64Array,
): Float64Array;
export function apply(
  [a, b, c, d, e, f]: Matrix,
  input: Point | Float64Array,
  target?: Float64Array,
): Point | Float64Array {
  if (!(input instanceof Float64Array)) {
    return {
      x: a * input.x + c * input.y + e,
      y: b * input.x + d * input.y + f,
    };
  }

  const output = target ?? new Float64Array(input.length);
  if (input.length % 2 !== 0 || output.length !== input.length) {
    throw new RangeError(
      "expected [x, y, …] pairs and a target of equal length",
    );
  }
  for (let index = 0; index < input.length; index += 2) {
    const x = input[index]!;
    const y = input[index + 1]!;
    output[index] = a * x + c * y + e;
    output[index + 1] = b * x + d * y + f;
  }
  return output;
}

export function decompose([a, b, c, d, e, f]: Matrix): Parts {
  const x = Math.hypot(a, b);
  const determinant = a * d - b * c;
  return {
    translation: { x: e, y: f },
    scale: { x, y: x === 0 ? 0 : determinant / x },
    rotation: Math.atan2(b, a),
    skew: determinant === 0 ? 0 : Math.atan((a * c + b * d) / determinant),
  };
}

export const compose = (parts: Parts): Matrix =>
  multiply(
    translate(parts.translation.x, parts.translation.y),
    rotate(parts.rotation),
    skew(parts.skew),
    scale(parts.scale.x, parts.scale.y),
  );

export const equals = (left: Matrix, right: Matrix, epsilon = 1e-9): boolean =>
  left.every((value, index) => Math.abs(value - right[index]!) <= epsilon);

export const round = (matrix: Matrix, digits = 10): Matrix =>
  from(rounded(matrix, digits));

export const format = (matrix: Matrix): string =>
  `matrix(${matrix.join(", ")})`;

export function parse(text: string): Matrix {
  const source = text.trim().toLowerCase();
  return source === "none" ? identity : from(numbers(source, "matrix"));
}

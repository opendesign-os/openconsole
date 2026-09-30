import * as plane from "./plane";
import { numbers, rounded } from "./values";

export type Matrix = readonly [
  m11: number,
  m12: number,
  m13: number,
  m14: number,
  m21: number,
  m22: number,
  m23: number,
  m24: number,
  m31: number,
  m32: number,
  m33: number,
  m34: number,
  m41: number,
  m42: number,
  m43: number,
  m44: number,
];

export interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

type Vector = readonly [x: number, y: number, z: number, w: number];

export const identity: Matrix = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
];

export function from(values: ArrayLike<number>): Matrix {
  if (values.length !== 16) {
    throw new RangeError(`expected 16 values, received ${values.length}`);
  }
  return [
    values[0]!,
    values[1]!,
    values[2]!,
    values[3]!,
    values[4]!,
    values[5]!,
    values[6]!,
    values[7]!,
    values[8]!,
    values[9]!,
    values[10]!,
    values[11]!,
    values[12]!,
    values[13]!,
    values[14]!,
    values[15]!,
  ];
}

export function lift([a, b, c, d, e, f]: plane.Matrix): Matrix {
  return [a, b, 0, 0, c, d, 0, 0, 0, 0, 1, 0, e, f, 0, 1];
}

export function translate(x: number, y: number, z: number): Matrix {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

export function scale(x: number, y: number, z: number): Matrix {
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
}

export function rotate(angle: number, axis: Point): Matrix {
  const length = Math.hypot(axis.x, axis.y, axis.z);
  if (length === 0) return identity;

  const x = axis.x / length;
  const y = axis.y / length;
  const z = axis.z / length;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const versine = 1 - cosine;
  return [
    versine * x * x + cosine,
    versine * x * y + sine * z,
    versine * x * z - sine * y,
    0,
    versine * x * y - sine * z,
    versine * y * y + cosine,
    versine * y * z + sine * x,
    0,
    versine * x * z + sine * y,
    versine * y * z - sine * x,
    versine * z * z + cosine,
    0,
    0,
    0,
    0,
    1,
  ];
}

function transform(
  matrix: Matrix,
  x: number,
  y: number,
  z: number,
  w: number,
): Vector {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12] * w,
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13] * w,
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14] * w,
    matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15] * w,
  ];
}

function product(outer: Matrix, inner: Matrix): Matrix {
  return [
    ...transform(outer, inner[0], inner[1], inner[2], inner[3]),
    ...transform(outer, inner[4], inner[5], inner[6], inner[7]),
    ...transform(outer, inner[8], inner[9], inner[10], inner[11]),
    ...transform(outer, inner[12], inner[13], inner[14], inner[15]),
  ];
}

export const multiply = (...matrices: readonly Matrix[]): Matrix =>
  matrices.reduce(product, identity);

export function invert(matrix: Matrix): Matrix | undefined {
  const s0 = matrix[0] * matrix[5] - matrix[1] * matrix[4];
  const s1 = matrix[0] * matrix[6] - matrix[2] * matrix[4];
  const s2 = matrix[0] * matrix[7] - matrix[3] * matrix[4];
  const s3 = matrix[1] * matrix[6] - matrix[2] * matrix[5];
  const s4 = matrix[1] * matrix[7] - matrix[3] * matrix[5];
  const s5 = matrix[2] * matrix[7] - matrix[3] * matrix[6];
  const c0 = matrix[8] * matrix[13] - matrix[9] * matrix[12];
  const c1 = matrix[8] * matrix[14] - matrix[10] * matrix[12];
  const c2 = matrix[8] * matrix[15] - matrix[11] * matrix[12];
  const c3 = matrix[9] * matrix[14] - matrix[10] * matrix[13];
  const c4 = matrix[9] * matrix[15] - matrix[11] * matrix[13];
  const c5 = matrix[10] * matrix[15] - matrix[11] * matrix[14];
  const determinant = s0 * c5 - s1 * c4 + s2 * c3 + s3 * c2 - s4 * c1 + s5 * c0;
  if (determinant === 0) return undefined;

  return [
    (matrix[5] * c5 - matrix[6] * c4 + matrix[7] * c3) / determinant,
    (matrix[2] * c4 - matrix[1] * c5 - matrix[3] * c3) / determinant,
    (matrix[13] * s5 - matrix[14] * s4 + matrix[15] * s3) / determinant,
    (matrix[10] * s4 - matrix[9] * s5 - matrix[11] * s3) / determinant,
    (matrix[6] * c2 - matrix[4] * c5 - matrix[7] * c1) / determinant,
    (matrix[0] * c5 - matrix[2] * c2 + matrix[3] * c1) / determinant,
    (matrix[14] * s2 - matrix[12] * s5 - matrix[15] * s1) / determinant,
    (matrix[8] * s5 - matrix[10] * s2 + matrix[11] * s1) / determinant,
    (matrix[4] * c4 - matrix[5] * c2 + matrix[7] * c0) / determinant,
    (matrix[1] * c2 - matrix[0] * c4 - matrix[3] * c0) / determinant,
    (matrix[12] * s4 - matrix[13] * s2 + matrix[15] * s0) / determinant,
    (matrix[9] * s2 - matrix[8] * s4 - matrix[11] * s0) / determinant,
    (matrix[5] * c1 - matrix[4] * c3 - matrix[6] * c0) / determinant,
    (matrix[0] * c3 - matrix[1] * c1 + matrix[2] * c0) / determinant,
    (matrix[13] * s1 - matrix[12] * s3 - matrix[14] * s0) / determinant,
    (matrix[8] * s3 - matrix[9] * s1 + matrix[10] * s0) / determinant,
  ];
}

export const linear = (matrix: Matrix): Matrix =>
  from([...matrix.slice(0, 12), 0, 0, 0, matrix[15]]);

export const around = (pivot: Point, matrix: Matrix): Matrix =>
  multiply(
    translate(pivot.x, pivot.y, pivot.z),
    matrix,
    translate(-pivot.x, -pivot.y, -pivot.z),
  );

export function apply(matrix: Matrix, point: Point): Point;
export function apply(
  matrix: Matrix,
  points: Float64Array,
  target?: Float64Array,
): Float64Array;
export function apply(
  matrix: Matrix,
  input: Point | Float64Array,
  target?: Float64Array,
): Point | Float64Array {
  if (!(input instanceof Float64Array)) {
    const [x, y, z, w] = transform(matrix, input.x, input.y, input.z, 1);
    const weight = w === 0 ? 1 : w;
    return { x: x / weight, y: y / weight, z: z / weight };
  }

  const output = target ?? new Float64Array(input.length);
  if (input.length % 3 !== 0 || output.length !== input.length) {
    throw new RangeError(
      "expected [x, y, z, …] triples and a target of equal length",
    );
  }
  for (let index = 0; index < input.length; index += 3) {
    const x = input[index]!;
    const y = input[index + 1]!;
    const z = input[index + 2]!;
    const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
    const weight = w === 0 ? 1 : w;
    output[index] =
      (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / weight;
    output[index + 1] =
      (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / weight;
    output[index + 2] =
      (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / weight;
  }
  return output;
}

export const equals = (left: Matrix, right: Matrix, epsilon = 1e-9): boolean =>
  left.every((value, index) => Math.abs(value - right[index]!) <= epsilon);

export const round = (matrix: Matrix, digits = 10): Matrix =>
  from(rounded(matrix, digits));

export const format = (matrix: Matrix): string =>
  `matrix3d(${matrix.join(", ")})`;

export function parse(text: string): Matrix {
  const source = text.trim().toLowerCase();
  return source.startsWith("matrix3d(")
    ? from(numbers(source, "matrix3d"))
    : lift(plane.parse(source));
}

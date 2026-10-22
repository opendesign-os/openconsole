/**
 * @file 三维射影变换：16 个数的定长只读元组，纯函数，与 CSS `matrix3d()` 直接互通。
 *
 * 列主序，`multiply(A, B, C)` 即 A·B·C，作用于点时自右向左（先 C 后 A）。
 * 存完整 4×4，不对末行作假设，因此能表达透视：{@link apply} 按齐次分量 `w` 做除法。
 * 二维仿射是它的子集，用 {@link lift} 与 {@link flatten} 往返。
 */

import * as plane from "./plane";
import type * as types from "./types";
import { numbers, rounded } from "./values";

type Matrix = types.Matrix<3, "projective">;
type Point = types.Point<3>;

/** 齐次坐标 `[x, y, z, w]`，透视除法之前的中间结果。 */
type Vector = readonly [x: number, y: number, z: number, w: number];

/** 单位矩阵，共享的只读常量。 */
export const identity: Matrix = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
];

/**
 * 从任意定长数组构造矩阵，用于接住 `DOMMatrix` 或解析结果。
 *
 * @param values 按 `m11, m12, …, m44` 排列的 16 个数。
 * @returns 新矩阵。
 * @throws {RangeError} 个数不是 16。
 */
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

/**
 * 把二维仿射矩阵升为三维射影矩阵：z 轴保持不变，无透视。
 *
 * @param matrix 二维仿射矩阵。
 * @returns 等价的三维射影矩阵。
 */
export function lift([a, b, c, d, e, f]: types.Matrix<2, "affine">): Matrix {
  return [a, b, 0, 0, c, d, 0, 0, 0, 0, 1, 0, e, f, 0, 1];
}

/**
 * 取出作用在 z = 0 平面上的二维仿射部分。
 *
 * 丢弃 z 与透视分量，所以只有不含这两者时才与原矩阵等价；含透视时结果是它在该平面上的近似。
 *
 * @param matrix 三维射影矩阵。
 * @returns 二维仿射矩阵。
 */
export const flatten = (matrix: Matrix): types.Matrix<2, "affine"> => [
  matrix[0],
  matrix[1],
  matrix[4],
  matrix[5],
  matrix[12],
  matrix[13],
];

/**
 * 平移矩阵。
 *
 * @param x 沿 x 的位移。
 * @param y 沿 y 的位移。
 * @param z 沿 z 的位移。
 * @returns 新矩阵。
 */
export function translate(x: number, y: number, z: number): Matrix {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

/**
 * 以原点为中心的缩放矩阵。
 *
 * @param x 沿 x 的系数。
 * @param y 沿 y 的系数。
 * @param z 沿 z 的系数。
 * @returns 新矩阵。
 */
export function scale(x: number, y: number, z: number): Matrix {
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
}

/**
 * 绕过原点的任意轴旋转，按 Rodrigues 公式展开。
 *
 * @param angle 角度（弧度），沿轴正方向看去顺时针。
 * @param axis 旋转轴，内部归一化。
 * @returns 新矩阵；轴为零向量时返回 {@link identity}。
 */
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

/** 矩阵乘齐次坐标，得到透视除法之前的 `[x, y, z, w]`。 */
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

/** 两个矩阵相乘，`outer` 在左：逐列把 `inner` 的列当作齐次坐标变换。 */
function product(outer: Matrix, inner: Matrix): Matrix {
  return [
    ...transform(outer, inner[0], inner[1], inner[2], inner[3]),
    ...transform(outer, inner[4], inner[5], inner[6], inner[7]),
    ...transform(outer, inner[8], inner[9], inner[10], inner[11]),
    ...transform(outer, inner[12], inner[13], inner[14], inner[15]),
  ];
}

/**
 * 依次相乘：`multiply(A, B, C)` 即 A·B·C，作用于点时自右向左（先 C 后 A）。
 *
 * @param matrices 自左向右的矩阵；为空时返回 {@link identity}。
 * @returns 新矩阵。
 */
export const multiply = (...matrices: readonly Matrix[]): Matrix =>
  matrices.reduce(product, identity);

/**
 * 求逆矩阵，按 2×2 子式（Laplace 展开）计算。
 *
 * @param matrix 原矩阵。
 * @returns 逆矩阵；行列式为 0（奇异）时为 `undefined`。
 */
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

/**
 * 只取线性部分，丢弃位移，保留透视分量，用于变换向量而非点。
 *
 * @param matrix 原矩阵。
 * @returns 位移为 0 的新矩阵。
 */
export const linear = (matrix: Matrix): Matrix =>
  from([...matrix.slice(0, 12), 0, 0, 0, matrix[15]]);

/**
 * 把变换搬到绕某点进行：`T(p)·M·T(−p)`。
 *
 * @param pivot 保持不动的点。
 * @param matrix 原本绕原点的变换。
 * @returns 新矩阵。
 */
export const around = (pivot: Point, matrix: Matrix): Matrix =>
  multiply(
    translate(pivot.x, pivot.y, pivot.z),
    matrix,
    translate(-pivot.x, -pivot.y, -pivot.z),
  );

/**
 * 变换一个点，按齐次分量 `w` 做透视除法。
 *
 * @param matrix 矩阵。
 * @param point 原始点。
 * @returns 变换后的新点；`w` 为 0（点落在消失面上）时按 1 处理，不产生 Infinity。
 */
export function apply(matrix: Matrix, point: Point): Point;
/**
 * 批量变换交错存放的坐标 `[x, y, z, x, y, z, …]`，循环内不分配对象。
 *
 * @param matrix 矩阵。
 * @param points 原始坐标，长度须为 3 的倍数。
 * @param target 写入目标，长度须与 `points` 相同；缺省时新建。
 * @returns 写入结果的数组，即 `target` 或新建的数组。
 * @throws {RangeError} 长度不是 3 的倍数，或 `target` 与 `points` 长度不同。
 */
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

/**
 * 逐元素比较两个矩阵。
 *
 * @param left 左矩阵。
 * @param right 右矩阵。
 * @param epsilon 允许的绝对误差；缺省为 1e-9。
 * @returns 每个元素的差都不超过 `epsilon` 时为 `true`。
 */
export const equals = (left: Matrix, right: Matrix, epsilon = 1e-9): boolean =>
  left.every((value, index) => Math.abs(value - right[index]!) <= epsilon);

/**
 * 按有效位数取整，消除浮点误差留下的尾数。
 *
 * @param matrix 原矩阵。
 * @param digits 小数位数；缺省为 10。
 * @returns 新矩阵。
 */
export const round = (matrix: Matrix, digits = 10): Matrix =>
  from(rounded(matrix, digits));

/**
 * 输出 CSS `matrix3d(…)`，可直接写入 `transform`。
 *
 * @param matrix 矩阵。
 * @returns CSS 函数记法。
 */
export const format = (matrix: Matrix): string =>
  `matrix3d(${matrix.join(", ")})`;

/**
 * 解析 CSS `matrix3d(…)`；不是三维形式时按二维解析再 {@link lift}，所以 `matrix(…)` 与 `"none"` 同样接受。
 *
 * @param text CSS 值，首尾空白与大小写不敏感。
 * @returns 新矩阵。
 * @throws {SyntaxError} 既不是 `matrix3d(…)` 也不是 `matrix(…)` 或 `"none"`，或其中含有非数字。
 * @throws {RangeError} 数字个数不是 16（二维时不是 6）。
 */
export function parse(text: string): Matrix {
  const source = text.trim().toLowerCase();
  return source.startsWith("matrix3d(")
    ? from(numbers(source, "matrix3d"))
    : lift(plane.parse(source));
}

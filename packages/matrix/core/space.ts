/**
 * @file 三维射影变换：16 个数的定长只读元组，纯函数，与 CSS `matrix3d()` 直接互通。
 *
 * 元组 `[m11, m12, …, m44]` 按列主序存放 4×4 齐次矩阵，`mij` 为第 i 列第 j 行
 * （与 `DOMMatrix` 的属性名一致），平移位于 `m41`、`m42`、`m43`：
 *
 *     | m11 m21 m31 m41 |
 *     | m12 m22 m32 m42 |
 *     | m13 m23 m33 m43 |
 *     | m14 m24 m34 m44 |
 *
 * `multiply(A, B, C)` 即 A·B·C，作用于点时自右向左（先 C 后 A）。
 * 存完整 4×4，不对末行作假设，因此能表达透视：{@link apply} 按齐次分量 `w` 做除法。
 * 二维仿射是它的子集，用 {@link lift} 与 {@link flatten} 往返。
 * 坐标系沿用 CSS：x 向右、y 向下、z 朝向观察者；所有函数都不修改入参。
 */

import * as plane from "./plane";
import type * as types from "./types";
import { numbers, rounded, sized } from "./values";

/** 本命名空间的矩阵：三维射影，16 个数的只读元组。 */
type Matrix = types.Matrix<3, "projective">;
/** 本命名空间的点：`{ x, y, z }`。 */
type Point = types.Point<3>;

/** 齐次坐标 `[x, y, z, w]`，透视除法之前的中间结果。 */
type Vector = readonly [x: number, y: number, z: number, w: number];

/**
 * 单位矩阵：不做任何变换，相当于 CSS `none`。
 *
 * 共享的只读常量，{@link multiply} 的乘法起点与旋转轴为零向量时 {@link rotate} 的结果都是它。
 */
export const identity: Matrix = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
];

/**
 * 从任意定长数组构造矩阵，用于接住 `DOMMatrix.toFloat64Array()` 或解析结果。
 *
 * 总是复制一份，之后修改 `values` 不影响结果。
 *
 * @param values 按 `m11, m12, …, m44`（列主序）排列的 16 个数。
 * @returns 新矩阵。
 * @throws {RangeError} 个数不是 16。
 * @example
 * from(new DOMMatrix(getComputedStyle(node).transform).toFloat64Array());
 */
export function from(values: ArrayLike<number>): Matrix {
  const copy = Array.from(values);
  if (!sized<Matrix>(copy, 16)) {
    throw new RangeError(`expected 16 values, received ${copy.length}`);
  }
  return copy;
}

/**
 * 把二维仿射矩阵升为三维射影矩阵：z 轴保持不变，无透视。
 *
 * @param matrix 二维仿射矩阵。
 * @returns 等价的三维射影矩阵，作用在 z = 0 平面上时与原矩阵相同。
 * @example
 * lift(plane.translate(10, 20)); // 等价于 translate(10, 20, 0)
 */
export function lift([a, b, c, d, e, f]: types.Matrix<2, "affine">): Matrix {
  return [a, b, 0, 0, c, d, 0, 0, 0, 0, 1, 0, e, f, 0, 1];
}

/**
 * 取出作用在 z = 0 平面上的二维仿射部分，即 `m11`、`m12`、`m21`、`m22`、`m41`、`m42`。
 *
 * 丢弃 z 与透视分量，所以只有不含这两者时才与原矩阵等价；含透视时结果是它在该平面上的近似。
 * 与 {@link lift} 互逆：`flatten(lift(m))` 总是等于 `m`。
 *
 * @param matrix 三维射影矩阵。
 * @returns 二维仿射矩阵。
 * @example
 * flatten(translate(10, 20, 30)); // [1, 0, 0, 1, 10, 20]：z 方向的位移被丢弃
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
 * 平移矩阵，相当于 CSS `translate3d(x, y, z)`。
 *
 * @param x 沿 x 的位移，向右为正。
 * @param y 沿 y 的位移，向下为正。
 * @param z 沿 z 的位移，朝向观察者为正。
 * @returns 新矩阵。
 * @example
 * translate(10, 20, 30); // 位移位于 m41、m42、m43
 */
export function translate(x: number, y: number, z: number): Matrix {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

/**
 * 以原点为中心的缩放矩阵，相当于 CSS `scale3d(x, y, z)`；系数为负表示沿该轴镜像。
 *
 * @param x 沿 x 的系数。
 * @param y 沿 y 的系数。
 * @param z 沿 z 的系数。
 * @returns 新矩阵。
 * @example
 * scale(2, 2, 1); // 平面内放大 2 倍，深度不变
 */
export function scale(x: number, y: number, z: number): Matrix {
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
}

/**
 * 绕过原点的任意轴旋转，按 Rodrigues 公式展开，相当于 CSS `rotate3d(x, y, z, angle)`。
 *
 * 方向与 CSS 一致：从轴的正端朝原点看去，正角度为顺时针；绕 z 轴时与 {@link plane.rotate} 相同。
 *
 * @param angle 角度（弧度）。
 * @param axis 旋转轴，内部归一化，长度不影响结果。
 * @returns 新矩阵；轴为零向量时返回 {@link identity}。
 * @example
 * rotate(Math.PI / 2, { x: 0, y: 0, z: 1 }); // 与 lift(plane.rotate(Math.PI / 2)) 等价
 * rotate(Math.PI / 4, { x: 0, y: 1, z: 0 }); // 相当于 CSS rotateY(45deg)
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

/**
 * 矩阵乘齐次坐标，得到透视除法之前的 `[x, y, z, w]`。
 *
 * @param matrix 矩阵。
 * @param x 齐次坐标的 x 分量。
 * @param y 齐次坐标的 y 分量。
 * @param z 齐次坐标的 z 分量。
 * @param w 齐次坐标的 w 分量；点取 1，方向向量取 0。
 * @returns 变换后的齐次坐标。
 */
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

/**
 * 两个矩阵相乘，`outer` 在左：逐列把 `inner` 的列当作齐次坐标变换。
 *
 * @param outer 左侧（后施加）的矩阵。
 * @param inner 右侧（先施加）的矩阵。
 * @returns 乘积 `outer·inner`。
 */
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
 * 书写顺序与 CSS `transform: A B C` 相同。矩阵乘法不可交换，顺序不同结果不同。
 *
 * @param matrices 自左向右的矩阵；为空时返回 {@link identity}。
 * @returns 新矩阵。
 * @example
 * multiply(translate(0, 0, -100), rotate(Math.PI / 6, { x: 1, y: 0, z: 0 }));
 * // 先绕 x 轴后仰 30°，再推远 100
 */
export const multiply = (...matrices: readonly Matrix[]): Matrix =>
  matrices.reduce(product, identity);

/**
 * 求逆矩阵，按 2×2 子式（Laplace 展开）计算，用于把投影后的坐标换回局部空间。
 *
 * @param matrix 原矩阵。
 * @returns 逆矩阵；行列式为 0（奇异）时为 `undefined`。
 * @example
 * invert(translate(10, 20, 30)); // 等价于 translate(-10, -20, -30)
 * invert(scale(1, 1, 0)); // undefined：z 轴被压扁，无法还原
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
 * 只取线性部分，丢弃位移（`m41`–`m43` 置 0），保留透视分量，用于变换向量而非点。
 *
 * @param matrix 原矩阵。
 * @returns 位移为 0 的新矩阵。
 * @example
 * linear(translate(10, 20, 30)); // 等价于 identity
 */
export const linear = (matrix: Matrix): Matrix =>
  from([...matrix.slice(0, 12), 0, 0, 0, matrix[15]]);

/**
 * 把变换搬到绕某点进行：`T(p)·M·T(−p)`，相当于 CSS 的 `transform-origin`。
 *
 * @param pivot 保持不动的点。
 * @param matrix 原本绕原点的变换。
 * @returns 新矩阵。
 * @example
 * around({ x: 50, y: 50, z: 0 }, rotate(Math.PI, { x: 0, y: 1, z: 0 })); // 绕竖直中线翻面
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
 * @example
 * const perspective = from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -1 / 100, 0, 0, 0, 1]);
 * apply(perspective, { x: 10, y: 0, z: 50 }); // { x: 20, y: 0, z: 100 }：越近越大
 */
export function apply(matrix: Matrix, point: Point): Point;
/**
 * 批量变换交错存放的坐标 `[x, y, z, x, y, z, …]`，循环内不分配对象，适合大量顶点。
 *
 * 透视除法与单点版本相同；`target` 可以就是 `points`，即原地变换。
 *
 * @param matrix 矩阵。
 * @param points 原始坐标，长度须为 3 的倍数。
 * @param target 写入目标，长度须与 `points` 相同；缺省时新建。
 * @returns 写入结果的数组，即 `target` 或新建的数组。
 * @throws {RangeError} 长度不是 3 的倍数，或 `target` 与 `points` 长度不同。
 * @example
 * apply(translate(1, 2, 3), new Float64Array([0, 0, 0])); // Float64Array [1, 2, 3]
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
    const x = input[index] ?? 0;
    const y = input[index + 1] ?? 0;
    const z = input[index + 2] ?? 0;
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
 * 逐元素比较两个矩阵，容忍浮点误差。
 *
 * @param left 左矩阵。
 * @param right 右矩阵。
 * @param epsilon 允许的绝对误差；缺省为 1e-9。
 * @returns 每个元素的差都不超过 `epsilon` 时为 `true`。
 * @example
 * equals(rotate(2 * Math.PI, { x: 0, y: 1, z: 0 }), identity); // true：误差在容差内
 */
export const equals = (left: Matrix, right: Matrix, epsilon = 1e-9): boolean =>
  left.every(
    (value, index) => Math.abs(value - (right[index] ?? Number.NaN)) <= epsilon,
  );

/**
 * 按小数位数四舍五入，消除浮点误差留下的尾数，`-0` 归一为 `0`。
 *
 * 常在 {@link format} 之前调用，让输出的 CSS 更短、更稳定。
 *
 * @param matrix 原矩阵。
 * @param digits 保留的小数位数；缺省为 10。
 * @returns 新矩阵。
 * @example
 * round(rotate(Math.PI / 2, { x: 0, y: 0, z: 1 })); // 尾数 6e-17 被抹为 0
 */
export const round = (matrix: Matrix, digits = 10): Matrix =>
  from(rounded(matrix, digits));

/**
 * 输出 CSS `matrix3d(…)`，可直接写入 `transform`。
 *
 * @param matrix 矩阵。
 * @returns CSS 函数记法，数字之间以 `", "` 分隔。
 * @example
 * format(translate(10, 20, 30));
 * // "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1)"
 */
export const format = (matrix: Matrix): string =>
  `matrix3d(${matrix.join(", ")})`;

/**
 * 解析 CSS `matrix3d(…)`；不是三维形式时按二维解析再 {@link lift}，所以 `matrix(…)` 与 `"none"` 同样接受。
 *
 * 计算样式里的 `transform` 只会是这三种形式之一，可以直接传入。
 *
 * @param text CSS 值，首尾空白与大小写不敏感。
 * @returns 新矩阵。
 * @throws {SyntaxError} 既不是 `matrix3d(…)` 也不是 `matrix(…)` 或 `"none"`，或其中含有非数字。
 * @throws {RangeError} 数字个数不是 16（二维时不是 6）。
 * @example
 * parse(getComputedStyle(node).transform);
 * parse("matrix(1, 0, 0, 1, 10, 20)"); // 等价于 lift(plane.translate(10, 20))
 */
export function parse(text: string): Matrix {
  const source = text.trim().toLowerCase();
  return source.startsWith("matrix3d(")
    ? from(numbers(source, "matrix3d"))
    : lift(plane.parse(source));
}

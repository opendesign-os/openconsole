/**
 * @file 二维仿射变换：6 个数的定长只读元组，纯函数，与 CSS `matrix()` 直接互通。
 *
 * 列主序，`multiply(A, B, C)` 即 A·B·C，作用于点时自右向左（先 C 后 A），
 * 与 CSS `transform: A B C` 的书写顺序一致。角度为弧度，坐标系沿用 CSS：
 * y 轴向下，正角度在屏幕上顺时针。
 */

import type * as types from "./types";
import { numbers, rounded } from "./values";

type Matrix = types.Matrix<2, "affine">;
type Point = types.Point<2>;

/** {@link decompose} 得到的各个分量，按位移、旋转、斜切、缩放的顺序复原。 */
export interface Parts {
  /** 位移。 */
  readonly translation: Point;
  /** 两轴的缩放系数；`y` 为负表示含镜像。 */
  readonly scale: Point;
  /** 旋转角（弧度）。 */
  readonly rotation: number;
  /** 沿 x 的斜切角（弧度）。 */
  readonly skew: number;
}

/** 单位矩阵，共享的只读常量。 */
export const identity: Matrix = [1, 0, 0, 1, 0, 0];

/**
 * 从任意定长数组构造矩阵，用于接住 `DOMMatrix` 或解析结果。
 *
 * @param values 按 `a, b, c, d, e, f` 排列的 6 个数。
 * @returns 新矩阵。
 * @throws {RangeError} 个数不是 6。
 */
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

/**
 * 平移矩阵。
 *
 * @param x 横向位移。
 * @param y 纵向位移。
 * @returns 新矩阵。
 */
export const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];

/**
 * 以原点为中心的缩放矩阵。
 *
 * @param x 横向系数。
 * @param y 纵向系数；缺省与 `x` 相同，即等比缩放。
 * @returns 新矩阵。
 */
export const scale = (x: number, y = x): Matrix => [x, 0, 0, y, 0, 0];

/**
 * 绕原点的旋转矩阵。
 *
 * @param angle 角度（弧度），正值在屏幕上顺时针。
 * @returns 新矩阵。
 */
export function rotate(angle: number): Matrix {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [cosine, sine, -sine, cosine, 0, 0];
}

/**
 * 斜切矩阵。
 *
 * @param x 沿 x 的斜切角（弧度）。
 * @param y 沿 y 的斜切角（弧度），缺省为 0。
 * @returns 新矩阵。
 */
export function skew(x: number, y = 0): Matrix {
  return [1, Math.tan(y), Math.tan(x), 1, 0, 0];
}

/**
 * 由一组基构造矩阵：把单位正方形映射到以 `origin` 为角、`x`、`y` 为邻边端点的平行四边形。
 *
 * @param origin 局部原点映射到的点。
 * @param x 局部 (1, 0) 映射到的点。
 * @param y 局部 (0, 1) 映射到的点。
 * @returns 新矩阵。
 */
export const basis = (origin: Point, x: Point, y: Point): Matrix => [
  x.x - origin.x,
  x.y - origin.y,
  y.x - origin.x,
  y.y - origin.y,
  origin.x,
  origin.y,
];

/**
 * 由两点的移动求相似变换（平移、旋转、等比缩放），用于双指手势。
 *
 * 两点重合时退化为平移，按第一个点的位移。结果精确把 `from` 的两点送到 `to` 的两点，
 * 位移、角度、缩放是同一个变换的三个分量，一次解出，与施加顺序无关。
 *
 * @param from 起始的两个点。
 * @param to 结束的两个点，与 `from` 一一对应。
 * @returns 新矩阵。
 */
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

/** 两个矩阵相乘，`outer` 在左：先施加 `inner`，再施加 `outer`。 */
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

/**
 * 依次相乘：`multiply(A, B, C)` 即 A·B·C，作用于点时自右向左（先 C 后 A）。
 *
 * @param matrices 自左向右的矩阵；为空时返回 {@link identity}。
 * @returns 新矩阵。
 * @example
 * const view = multiply(translate(100, 50), scale(2)); // 先缩放后平移
 */
export const multiply = (...matrices: readonly Matrix[]): Matrix =>
  matrices.reduce(product, identity);

/**
 * 求逆矩阵。
 *
 * @param matrix 原矩阵。
 * @returns 逆矩阵；行列式为 0（奇异，如某轴缩放为 0）时为 `undefined`。
 */
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

/**
 * 只取线性部分，丢弃位移，用于变换向量而非点。
 *
 * @param matrix 原矩阵。
 * @returns 位移为 0 的新矩阵。
 */
export const linear = ([a, b, c, d]: Matrix): Matrix => [a, b, c, d, 0, 0];

/**
 * 把变换搬到绕某点进行：`T(p)·M·T(−p)`。
 *
 * @param pivot 保持不动的点。
 * @param matrix 原本绕原点的变换。
 * @returns 新矩阵。
 * @example
 * around({ x: 50, y: 50 }, rotate(Math.PI / 2)); // 绕 (50, 50) 旋转 90°
 */
export const around = (pivot: Point, matrix: Matrix): Matrix =>
  multiply(translate(pivot.x, pivot.y), matrix, translate(-pivot.x, -pivot.y));

/**
 * 变换一个点。
 *
 * @param matrix 矩阵。
 * @param point 原始点。
 * @returns 变换后的新点。
 */
export function apply(matrix: Matrix, point: Point): Point;
/**
 * 批量变换交错存放的坐标 `[x, y, x, y, …]`，循环内不分配对象。
 *
 * @param matrix 矩阵。
 * @param points 原始坐标，长度须为偶数。
 * @param target 写入目标，长度须与 `points` 相同；缺省时新建。
 * @returns 写入结果的数组，即 `target` 或新建的数组。
 * @throws {RangeError} 长度不是偶数，或 `target` 与 `points` 长度不同。
 */
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

/**
 * 分解为位移、旋转、斜切、缩放，用于读出单个分量或做插值。
 *
 * 按 QR 分解的约定：先确定旋转，再把剩余部分算作斜切与缩放。含镜像时 `scale.y` 为负。
 *
 * @param matrix 原矩阵。
 * @returns 各个分量，交给 {@link compose} 可还原。
 */
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

/**
 * 由各个分量合成矩阵，顺序为位移、旋转、斜切、缩放。
 *
 * @param parts 各个分量，通常来自 {@link decompose}。
 * @returns 新矩阵。
 */
export const compose = (parts: Parts): Matrix =>
  multiply(
    translate(parts.translation.x, parts.translation.y),
    rotate(parts.rotation),
    skew(parts.skew),
    scale(parts.scale.x, parts.scale.y),
  );

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
 * 输出 CSS `matrix(…)`，可直接写入 `transform`。
 *
 * @param matrix 矩阵。
 * @returns CSS 函数记法。
 */
export const format = (matrix: Matrix): string =>
  `matrix(${matrix.join(", ")})`;

/**
 * 解析 CSS `matrix(…)`，`"none"` 得到 {@link identity}。
 *
 * 只认 `matrix()`：计算样式里的 `transform` 总是这种形式，`translate(…)` 等关键字形式不支持。
 *
 * @param text CSS 值，首尾空白与大小写不敏感。
 * @returns 新矩阵。
 * @throws {SyntaxError} 不是 `matrix(…)` 形式，或其中含有非数字。
 * @throws {RangeError} 数字个数不是 6。
 */
export function parse(text: string): Matrix {
  const source = text.trim().toLowerCase();
  return source === "none" ? identity : from(numbers(source, "matrix"));
}

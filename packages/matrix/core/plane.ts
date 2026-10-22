/**
 * @file 二维仿射变换：6 个数的定长只读元组，纯函数，与 CSS `matrix()` 直接互通。
 *
 * 元组 `[a, b, c, d, e, f]` 按列主序表示 3×3 齐次矩阵，末行恒为 `0 0 1`：
 *
 *     | a c e |
 *     | b d f |
 *     | 0 0 1 |
 *
 * 点 `(x, y)` 映射为 `(a·x + c·y + e, b·x + d·y + f)`。`multiply(A, B, C)` 即 A·B·C，
 * 作用于点时自右向左（先 C 后 A），与 CSS `transform: A B C` 的书写顺序一致。
 * 角度为弧度，坐标系沿用 CSS：y 轴向下，正角度在屏幕上顺时针。
 * 所有函数都不修改入参，总是返回新的元组或点。
 */

import type * as types from "./types";
import { numbers, rounded, sized } from "./values";

/** 本命名空间的矩阵：二维仿射，6 个数的只读元组。 */
type Matrix = types.Matrix<2, "affine">;
/** 本命名空间的点：`{ x, y }`。 */
type Point = types.Point<2>;

/**
 * {@link decompose} 得到的各个分量，交给 {@link compose} 可还原矩阵。
 *
 * 合成顺序为 `M = T·R·K·S`（位移、旋转、斜切、缩放），作用于点时先缩放、再斜切、
 * 再旋转、最后位移；插值时对各分量分别插值再合成，比直接插值矩阵元素更自然。
 */
export interface Parts {
  /** 位移，即矩阵的 `e`、`f`。 */
  readonly translation: Point;
  /** 两轴的缩放系数；`y` 为负表示含镜像（行列式为负）。 */
  readonly scale: Point;
  /** 旋转角（弧度），取值在 `[-π, π]`。 */
  readonly rotation: number;
  /** 沿 x 的斜切角（弧度），取值在 `(-π/2, π/2)`。 */
  readonly skew: number;
}

/**
 * 单位矩阵：不做任何变换，相当于 CSS `none`。
 *
 * 共享的只读常量，{@link multiply} 的乘法起点与 {@link parse} 解析 `"none"` 的结果都是它。
 */
export const identity: Matrix = [1, 0, 0, 1, 0, 0];

/**
 * 从任意定长数组构造矩阵，用于接住 `DOMMatrix` 的分量、`Float64Array` 或解析结果。
 *
 * 总是复制一份，之后修改 `values` 不影响结果。
 *
 * @param values 按 `a, b, c, d, e, f` 排列的 6 个数。
 * @returns 新矩阵。
 * @throws {RangeError} 个数不是 6。
 * @example
 * const { a, b, c, d, e, f } = new DOMMatrix(getComputedStyle(node).transform);
 * const matrix = from([a, b, c, d, e, f]);
 */
export function from(values: ArrayLike<number>): Matrix {
  const copy = Array.from(values);
  if (!sized<Matrix>(copy, 6)) {
    throw new RangeError(`expected 6 values, received ${copy.length}`);
  }
  return copy;
}

/**
 * 平移矩阵，相当于 CSS `translate(x, y)`。
 *
 * @param x 横向位移，向右为正。
 * @param y 纵向位移，向下为正。
 * @returns 新矩阵。
 * @example
 * translate(10, 20); // [1, 0, 0, 1, 10, 20]
 */
export const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];

/**
 * 以原点为中心的缩放矩阵，相当于 CSS `scale(x, y)`；系数为负表示沿该轴镜像。
 *
 * 要绕别的点缩放，用 {@link around} 包一层。
 *
 * @param x 横向系数。
 * @param y 纵向系数；缺省与 `x` 相同，即等比缩放。
 * @returns 新矩阵。
 * @example
 * scale(2); // [2, 0, 0, 2, 0, 0]
 * scale(1, -1); // 上下镜像
 */
export const scale = (x: number, y = x): Matrix => [x, 0, 0, y, 0, 0];

/**
 * 绕原点的旋转矩阵，相当于 CSS `rotate(angle)`。
 *
 * 要绕别的点旋转，用 {@link around} 包一层。
 *
 * @param angle 角度（弧度），正值在屏幕上顺时针。
 * @returns 新矩阵。
 * @example
 * rotate(Math.PI / 2); // 顺时针 90°，约为 [0, 1, -1, 0, 0, 0]
 */
export function rotate(angle: number): Matrix {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [cosine, sine, -sine, cosine, 0, 0];
}

/**
 * 斜切矩阵，相当于 CSS `skew(x, y)`。
 *
 * @param x 沿 x 的斜切角（弧度）：每向下 1 个单位，横向偏移 `tan(x)`。
 * @param y 沿 y 的斜切角（弧度）：每向右 1 个单位，纵向偏移 `tan(y)`；缺省为 0。
 * @returns 新矩阵。
 * @example
 * skew(Math.PI / 4); // 约为 [1, 0, 1, 1, 0, 0]：每向下 1px，向右偏 1px
 */
export function skew(x: number, y = 0): Matrix {
  return [1, Math.tan(y), Math.tan(x), 1, 0, 0];
}

/**
 * 由一组基构造矩阵：把单位正方形映射到以 `origin` 为角、`x`、`y` 为邻边端点的平行四边形。
 *
 * 常用于把局部坐标挂到一个已知的平行四边形上，例如由三个角点还原元素的变换。
 *
 * @param origin 局部原点 (0, 0) 映射到的点。
 * @param x 局部 (1, 0) 映射到的点。
 * @param y 局部 (0, 1) 映射到的点。
 * @returns 新矩阵。
 * @example
 * basis({ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 10, y: 60 });
 * // [100, 0, 0, 50, 10, 10]：单位正方形 → 左上角在 (10, 10) 的 100×50 矩形
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
 * 结果精确把 `from` 的两点送到 `to` 的两点。把两点之间的向量看作复数，线性部分即
 * `(to₁ − to₀) / (from₁ − from₀)`：模为缩放比、辐角为旋转角；位移再由第一个点对齐求出。
 * 三个分量是同一个变换一次解出的，与施加顺序无关。两个起点重合时无法确定旋转与缩放，
 * 退化为按第一个点的位移做平移。
 *
 * @param from 起始的两个点。
 * @param to 结束的两个点，与 `from` 一一对应。
 * @returns 新矩阵。
 * @example
 * // 两指从 (0, 0)、(10, 0) 移到 (0, 0)、(0, 20)：顺时针转 90° 并放大 2 倍
 * pinch([{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 0, y: 0 }, { x: 0, y: 20 }]);
 * // [0, 2, -2, 0, 0, 0]
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

/**
 * 两个矩阵相乘，`outer` 在左：先施加 `inner`，再施加 `outer`。
 *
 * @param outer 左侧（后施加）的矩阵。
 * @param inner 右侧（先施加）的矩阵。
 * @returns 乘积 `outer·inner`。
 */
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
 * 书写顺序与 CSS `transform: A B C` 相同，可直接对照样式表理解。矩阵乘法不可交换，
 * 顺序不同结果不同。
 *
 * @param matrices 自左向右的矩阵；为空时返回 {@link identity}。
 * @returns 新矩阵。
 * @example
 * multiply(translate(100, 50), scale(2)); // [2, 0, 0, 2, 100, 50]：先缩放后平移
 * multiply(scale(2), translate(100, 50)); // [2, 0, 0, 2, 200, 100]：平移量也被放大
 */
export const multiply = (...matrices: readonly Matrix[]): Matrix =>
  matrices.reduce(product, identity);

/**
 * 求逆矩阵：撤销 `matrix` 的变换，例如把屏幕坐标换回元素的局部坐标。
 *
 * @param matrix 原矩阵。
 * @returns 逆矩阵；行列式为 0（奇异，如某轴缩放为 0）时为 `undefined`。
 * @example
 * invert(translate(10, 20)); // 等价于 translate(-10, -20)
 * invert(scale(0, 1)); // undefined：x 轴被压扁，无法还原
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
 * 只取线性部分，丢弃位移，用于变换向量（位移量、速度、法线）而非点。
 *
 * @param matrix 原矩阵。
 * @returns 位移为 0 的新矩阵。
 * @example
 * linear(multiply(translate(10, 20), scale(2))); // [2, 0, 0, 2, 0, 0]
 */
export const linear = ([a, b, c, d]: Matrix): Matrix => [a, b, c, d, 0, 0];

/**
 * 把变换搬到绕某点进行：`T(p)·M·T(−p)`，即先把 `pivot` 移到原点、施加 `matrix`、再移回。
 *
 * 相当于 CSS 的 `transform-origin`。
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
 * @example
 * apply(translate(10, 20), { x: 1, y: 2 }); // { x: 11, y: 22 }
 */
export function apply(matrix: Matrix, point: Point): Point;
/**
 * 批量变换交错存放的坐标 `[x, y, x, y, …]`，循环内不分配对象，适合大量顶点。
 *
 * `target` 可以就是 `points`，即原地变换。
 *
 * @param matrix 矩阵。
 * @param points 原始坐标，长度须为偶数。
 * @param target 写入目标，长度须与 `points` 相同；缺省时新建。
 * @returns 写入结果的数组，即 `target` 或新建的数组。
 * @throws {RangeError} 长度不是偶数，或 `target` 与 `points` 长度不同。
 * @example
 * apply(scale(2), new Float64Array([1, 2, 3, 4])); // Float64Array [2, 4, 6, 8]
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
    const x = input[index] ?? 0;
    const y = input[index + 1] ?? 0;
    output[index] = a * x + c * y + e;
    output[index + 1] = b * x + d * y + f;
  }
  return output;
}

/**
 * 分解为位移、旋转、斜切、缩放，用于读出单个分量或做插值。
 *
 * 按 QR 分解的约定：先由第一列确定旋转与 x 缩放，再把剩余部分算作斜切与 y 缩放；
 * 含镜像时 `scale.y` 为负。可逆矩阵经 {@link compose} 可还原（误差在浮点精度内）；
 * 奇异矩阵会丢失被压扁的那一维，无法还原。
 *
 * @param matrix 原矩阵。
 * @returns 各个分量，交给 {@link compose} 可还原。
 * @example
 * decompose(multiply(translate(10, 0), rotate(Math.PI / 2), scale(2)));
 * // { translation: { x: 10, y: 0 }, scale: { x: 2, y: 2 }, rotation: π/2, skew: 0 }
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
 * 由各个分量合成矩阵：`T·R·K·S`，顺序为位移、旋转、斜切、缩放。
 *
 * @param parts 各个分量，通常来自 {@link decompose}。
 * @returns 新矩阵。
 * @example
 * equals(compose(decompose(matrix)), matrix); // true（matrix 可逆时）
 */
export const compose = (parts: Parts): Matrix =>
  multiply(
    translate(parts.translation.x, parts.translation.y),
    rotate(parts.rotation),
    skew(parts.skew),
    scale(parts.scale.x, parts.scale.y),
  );

/**
 * 逐元素比较两个矩阵，容忍浮点误差。
 *
 * @param left 左矩阵。
 * @param right 右矩阵。
 * @param epsilon 允许的绝对误差；缺省为 1e-9。
 * @returns 每个元素的差都不超过 `epsilon` 时为 `true`。
 * @example
 * equals(rotate(2 * Math.PI), identity); // true：误差约 2e-16，在容差内
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
 * round(rotate(Math.PI / 2)); // [0, 1, -1, 0, 0, 0]
 */
export const round = (matrix: Matrix, digits = 10): Matrix =>
  from(rounded(matrix, digits));

/**
 * 输出 CSS `matrix(…)`，可直接写入 `transform`。
 *
 * @param matrix 矩阵。
 * @returns CSS 函数记法，数字之间以 `", "` 分隔。
 * @example
 * node.style.transform = format(translate(10, 20)); // "matrix(1, 0, 0, 1, 10, 20)"
 */
export const format = (matrix: Matrix): string =>
  `matrix(${matrix.join(", ")})`;

/**
 * 解析 CSS `matrix(…)`，`"none"` 得到 {@link identity}。
 *
 * 只认 `matrix()`：计算样式里的二维 `transform` 总是这种形式，`translate(…)` 等关键字形式不支持；
 * 三维的 `matrix3d(…)` 交给 `space.parse`。
 *
 * @param text CSS 值，首尾空白与大小写不敏感。
 * @returns 新矩阵。
 * @throws {SyntaxError} 不是 `matrix(…)` 形式，或其中含有非数字。
 * @throws {RangeError} 数字个数不是 6。
 * @example
 * parse(getComputedStyle(node).transform);
 * parse("matrix(2, 0, 0, 2, 10, 20)"); // [2, 0, 0, 2, 10, 20]
 */
export function parse(text: string): Matrix {
  const source = text.trim().toLowerCase();
  return source === "none" ? identity : from(numbers(source, "matrix"));
}

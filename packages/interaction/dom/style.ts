/**
 * @file 把计算样式里的变换折叠成矩阵。
 *
 * 按 CSS Transforms 2 的合成顺序：`T(origin)·translate·rotate·scale·transform·T(−origin)`；
 * 三维部分先合成，再压平成二维仿射矩阵。
 */

import { plane, space, type Matrix, type Point } from "@openconsole/matrix";

import type { Size } from "../model";

/** 参与变换的计算样式原文，由 `computed` 读出。 */
export interface Computed {
  /** `transform-origin`，计算值为像素，如 `"40px 25px 0px"`。 */
  readonly origin: string;
  /** `translate` 属性，如 `"10px 20%"`，百分比相对边框盒宽高；`"none"` 表示无。 */
  readonly translate: string;
  /** `rotate` 属性，如 `"45deg"`、`"x 30deg"` 或 `"1 0 0 30deg"`；`"none"` 表示无。 */
  readonly rotate: string;
  /** `scale` 属性，如 `"2"` 或 `"1 0.5"`；`"none"` 表示无。 */
  readonly scale: string;
  /** `transform` 的计算值：`matrix(…)`、`matrix3d(…)` 或 `"none"`。 */
  readonly transform: string;
}

/** `rotate` 写法里的轴名到单位轴向量。 */
const axes = new Map([
  ["x", { x: 1, y: 0, z: 0 }],
  ["y", { x: 0, y: 1, z: 0 }],
  ["z", { x: 0, y: 0, z: 1 }],
]);

/**
 * 解析 `rotate` 属性：支持 `角度`、`轴名 角度`、`x y z 角度` 三种写法，角度为度，缺省绕 z 轴。
 */
function rotation(text: string): Matrix<3, "projective"> {
  if (text === "none") return space.identity;
  const parts = text.split(" ");
  const angle = (Number.parseFloat(parts.at(-1) ?? "") * Math.PI) / 180;
  const axis =
    parts.length === 4
      ? { x: Number(parts[0]), y: Number(parts[1]), z: Number(parts[2]) }
      : (axes.get(parts[0] ?? "") ?? { x: 0, y: 0, z: 1 });
  return space.rotate(angle, axis);
}

/** 解析 `scale` 属性：一个值为等比缩放，缺少的 z 为 1。 */
function scaling(text: string): Matrix<3, "projective"> {
  if (text === "none") return space.identity;
  const [x = 1, y = x, z = 1] = text.split(" ").map(Number);
  return space.scale(x, y, z);
}

/**
 * 解析一个长度：像素原样返回，百分比按 `base` 换算，缺省为 0；其他单位无法离线换算，为 undefined。
 */
function length(token: string | undefined, base: number): number | undefined {
  if (token === undefined) return 0;
  if (token.endsWith("px")) return Number.parseFloat(token);
  if (token.endsWith("%")) return (Number.parseFloat(token) / 100) * base;
  return undefined;
}

/**
 * 解析 `translate` 属性：x、y 的百分比分别相对边框盒的宽、高，z 不接受百分比。
 * 含 `calc()` 等函数或无法换算的单位时为 undefined。
 */
function translation(
  text: string,
  size: Size,
): Matrix<3, "projective"> | undefined {
  if (text === "none") return space.identity;
  if (text.includes("(")) return undefined;
  const [x, y, z] = text.split(" ");
  const dx = length(x, size.width);
  const dy = length(y, size.height);
  const dz = length(z, 0);
  if (dx === undefined || dy === undefined || dz === undefined)
    return undefined;
  return space.translate(dx, dy, dz);
}

/** 解析 `transform-origin` 的像素三元组：缺少的 z 为 0；任一分量不是像素时为 undefined。 */
function point(text: string): Point<3> | undefined {
  const [x, y, z = 0] = text
    .split(" ")
    .map((token) =>
      token.endsWith("px") ? Number.parseFloat(token) : Number.NaN,
    );
  if (x === undefined || y === undefined) return undefined;
  if ([x, y, z].some(Number.isNaN)) return undefined;
  return { x, y, z };
}

/**
 * 节点自身变换的线性部分：只合成 `rotate`、`scale`、`transform`。
 * `translate` 与 `transform-origin` 只影响平移，这里忽略；用于沿祖先链合成线性部分。
 *
 * @param computed 计算样式中的 `rotate`、`scale`、`transform`。
 * @returns 平移分量为 0 的二维仿射矩阵。
 */
export const local = (
  computed: Pick<Computed, "rotate" | "scale" | "transform">,
): Matrix<2, "affine"> =>
  plane.linear(
    space.flatten(
      space.multiply(
        rotation(computed.rotate),
        scaling(computed.scale),
        space.parse(computed.transform),
      ),
    ),
  );

/**
 * 把节点的全部变换样式按规范顺序折叠成一个矩阵：
 * `T(origin)·translate·rotate·scale·transform·T(−origin)`。
 *
 * 结果把局部空间映射到以布局位置为原点的空间，再左乘 `T(offsetLeft, offsetTop)` 即到容器空间。
 * 接管节点时调用一次，此后几何只由状态矩阵决定。
 *
 * @param computed 计算样式中的五项变换。
 * @param size 边框盒宽高，用于换算 `translate` 的百分比。
 * @returns 二维仿射矩阵；`transform-origin` 或 `translate` 无法换算成像素时为 undefined。
 */
export function fold(
  computed: Computed,
  size: Size,
): Matrix<2, "affine"> | undefined {
  const origin = point(computed.origin);
  const shift = translation(computed.translate, size);
  if (!origin || !shift) return undefined;
  return space.flatten(
    space.multiply(
      space.translate(origin.x, origin.y, origin.z),
      shift,
      rotation(computed.rotate),
      scaling(computed.scale),
      space.parse(computed.transform),
      space.translate(-origin.x, -origin.y, -origin.z),
    ),
  );
}

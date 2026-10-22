/**
 * @file 屏幕坐标与容器空间之间的换算。
 *
 * frame 指"屏幕坐标 → 容器空间"的仿射矩阵 F。节点的状态矩阵把局部空间映到容器空间，
 * 容器空间再经祖先链映到屏幕；F 由祖先链的线性部分和节点在屏幕上的包围盒中心反推出来。
 */

import { plane, type Matrix } from "@openconsole/matrix";

import type { Bounds, State } from "../model";

/**
 * 换容器：节点移到另一个容器时，求保持屏幕位置不变的新状态矩阵 `to·from⁻¹·matrix`。
 *
 * `from⁻¹·matrix` 把局部空间映到屏幕，再由 `to` 映到新的容器空间；旋转、缩放与尺寸都不变。
 *
 * @param matrix 节点在旧容器空间里的状态矩阵。
 * @param from 移动前的 frame（屏幕坐标 → 旧容器空间）。
 * @param to 移动后的 frame（屏幕坐标 → 新容器空间）。
 * @returns 新容器空间里的状态矩阵；`from` 不可逆时为 `undefined`。
 */
export function convert(
  matrix: Matrix<2, "affine">,
  from: Matrix<2, "affine">,
  to: Matrix<2, "affine">,
): Matrix<2, "affine"> | undefined {
  const inverse = plane.invert(from);
  return inverse && plane.multiply(to, inverse, matrix);
}

/**
 * 求 frame（屏幕坐标 → 容器空间）。
 *
 * 设祖先链的线性部分为 L，节点盒中心在容器空间为 c = M·(w/2, h/2)，在屏幕上为 s
 * （`getBoundingClientRect` 的中心）。容器空间到屏幕的映射 P = [L | s − L·c]：
 * 线性部分取 L，平移部分让 c 恰好落到 s；frame 为 F = P⁻¹。
 * 用中心而不用角点：平行四边形的包围盒中心就是它的中心，不受旋转、斜切影响。
 *
 * @param linear 容器空间到屏幕的线性部分（祖先链各层变换的乘积，平移分量不用）。
 * @param box 节点在屏幕上的包围盒。
 * @param state 节点当前状态。
 * @returns frame；L 不可逆（例如某层缩放为 0）时为 `undefined`。
 */
export function frame(
  linear: Matrix<2, "affine">,
  box: Bounds,
  state: State,
): Matrix<2, "affine"> | undefined {
  const [a, b, c, d] = linear;
  const middle = plane.apply(state.matrix, {
    x: state.size.width / 2,
    y: state.size.height / 2,
  });
  return plane.invert([
    a,
    b,
    c,
    d,
    (box.left + box.right) / 2 - (a * middle.x + c * middle.y),
    (box.top + box.bottom) / 2 - (b * middle.x + d * middle.y),
  ]);
}

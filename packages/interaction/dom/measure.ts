/**
 * @file DOM 测量：读出节点的线性变换、尺寸、布局偏移与屏幕多边形，必要时写回尺寸。
 *
 * 涉及三种空间：屏幕坐标（client）、容器空间（offsetParent 内边距盒，左上为原点）、
 * 局部空间（节点边框盒，左上为原点）。
 */

import { plane, type Matrix, type Point } from "@openconsole/matrix";

import { frame } from "../core";
import {
  corners,
  type Bounds,
  type Polygon,
  type Range,
  type Size,
} from "../model";
import { local, type Computed } from "./style";

/** 尺寸轴：选择宽或高方向的内边距、边框与 `min-*`、`max-*`。 */
type Axis = "width" | "height";

/** 把计算样式里的像素值（如 `"12.5px"`）解析成数字；无法解析时为 0。 */
const pixels = (value: string): number => Number.parseFloat(value) || 0;

/**
 * 沿渲染树取上一级：被分配进 slot 的元素取 slot，shadow root 下的顶层元素取宿主，
 * 其余取父元素；到达根部时为 null。
 */
function parent(element: Element): Element | null {
  if (element.assignedSlot) return element.assignedSlot;
  if (element.parentElement) return element.parentElement;
  const root = element.parentNode;
  return root instanceof ShadowRoot ? root.host : null;
}

/**
 * 沿祖先链合成容器空间到屏幕坐标的线性部分（不含平移）。
 *
 * 从直接父级一直乘到根，每级取自身 `rotate`、`scale`、`transform` 的线性部分；
 * `display: inline` 与 `contents` 的祖先不建立变换，跳过；遍历会进入 slot、穿过 shadow root 到宿主。
 * 不含节点自身的变换，见 {@link own}。
 *
 * @param node 要测量的节点。
 * @returns 平移分量为 0 的仿射矩阵：把容器空间里的向量换算成屏幕上的向量。
 */
export function linear(node: Element): Matrix<2, "affine"> {
  let chain: Matrix<2, "affine"> = plane.identity;
  for (let element = parent(node); element; element = parent(element)) {
    const style = getComputedStyle(element);
    if (style.display === "inline" || style.display === "contents") continue;
    chain = plane.multiply(local(style), chain);
  }
  return chain;
}

/**
 * 节点自身变换（`rotate`、`scale`、`transform`）的线性部分，不含祖先。
 *
 * @param node 要测量的节点。
 * @returns 平移分量为 0 的仿射矩阵：把局部空间里的向量换算到容器空间。
 */
export const own = (node: Element): Matrix<2, "affine"> =>
  local(getComputedStyle(node));

/**
 * 节点在屏幕坐标里的轴对齐包围盒（`getBoundingClientRect`），已包含祖先与自身的全部变换。
 *
 * @param node 要测量的节点。
 * @returns 屏幕坐标下的包围盒。
 */
export function rect(node: Element): Bounds {
  const { left, top, right, bottom } = node.getBoundingClientRect();
  return { left, top, right, bottom };
}

/**
 * 节点布局盒在容器空间里的位置与大小（`offsetLeft`、`offsetTop`、`offsetWidth`、`offsetHeight`），
 * 不受 CSS 变换影响，取整数像素。
 *
 * @param node 要测量的节点。
 * @returns 容器空间里的轴对齐盒。
 */
export const box = (node: HTMLElement): Bounds => ({
  left: node.offsetLeft,
  top: node.offsetTop,
  right: node.offsetLeft + node.offsetWidth,
  bottom: node.offsetTop + node.offsetHeight,
});

/**
 * 节点布局位置在容器空间里的左上角（`offsetLeft`、`offsetTop`），不受 CSS 变换影响。
 *
 * @param node 要测量的节点。
 * @returns 容器空间里的点（整数像素）。
 */
export const offset = (node: HTMLElement): Point<2> => ({
  x: node.offsetLeft,
  y: node.offsetTop,
});

/**
 * 节点是否已接入文档并生成了盒子；未挂载或 `display: none` 时为 false，此时无法测量与折叠。
 *
 * @param node 要检查的节点。
 * @returns 能否测量。
 */
export const rendered = (node: Element): boolean =>
  node.isConnected && node.getClientRects().length > 0;

/**
 * 读出参与变换的计算样式，交给 `fold` 折叠成矩阵。
 *
 * @param node 要读取的节点。
 * @returns `transform-origin`、`translate`、`rotate`、`scale`、`transform` 的计算值原文。
 */
export function computed(node: Element): Computed {
  const style = getComputedStyle(node);
  return {
    origin: style.transformOrigin,
    translate: style.translate,
    rotate: style.rotate,
    scale: style.scale,
    transform: style.transform,
  };
}

/**
 * 该轴上计算样式宽高与边框盒之间的差：`content-box` 时为内边距加边框，`border-box` 时为 0。
 */
function inset(style: CSSStyleDeclaration, axis: Axis): number {
  if (style.boxSizing === "border-box") return 0;
  return axis === "width"
    ? pixels(style.paddingLeft) +
        pixels(style.paddingRight) +
        pixels(style.borderLeftWidth) +
        pixels(style.borderRightWidth)
    : pixels(style.paddingTop) +
        pixels(style.paddingBottom) +
        pixels(style.borderTopWidth) +
        pixels(style.borderBottomWidth);
}

/**
 * 节点边框盒的宽高：未变换的布局尺寸，可为小数。
 *
 * 读计算样式的 `width`、`height`，`box-sizing: content-box` 时补上内边距与边框，统一换算成边框盒。
 *
 * @param node 要测量的节点。
 * @returns 边框盒宽高（像素）。
 */
export function size(node: HTMLElement): Size {
  const style = getComputedStyle(node);
  return {
    width: pixels(style.width) + inset(style, "width"),
    height: pixels(style.height) + inset(style, "height"),
  };
}

/**
 * 把边框盒宽高写回内联 `width`、`height`：按 `box-sizing` 扣掉内边距与边框，结果不小于 0。
 *
 * @param node 要写入的节点。
 * @param size 目标边框盒宽高（像素）。
 */
export function write(node: HTMLElement, size: Size): void {
  const style = getComputedStyle(node);
  node.style.width = `${Math.max(0, size.width - inset(style, "width"))}px`;
  node.style.height = `${Math.max(0, size.height - inset(style, "height"))}px`;
}

/**
 * 量出节点在给定宽度下的自然高度：临时把内联宽度设为 `width`、高度设为 `auto`，
 * 读出边框盒高度后还原内联样式。期间触发一次同步布局，不会留下样式改动。
 *
 * @param node 要测量的节点。
 * @param width 目标边框盒宽度（像素）。
 * @returns 该宽度下内容撑开的边框盒高度（像素）。
 */
export function intrinsic(node: HTMLElement, width: number): number {
  const saved = { width: node.style.width, height: node.style.height };
  const extra = inset(getComputedStyle(node), "width");
  node.style.width = `${Math.max(0, width - extra)}px`;
  node.style.height = "auto";
  const { height } = size(node);
  Object.assign(node.style, saved);
  return height;
}

/**
 * 节点局部空间到屏幕坐标的仿射矩阵：线性部分取祖先链与自身变换，平移由屏幕包围盒中心反推
 * （同 core 的 `frame`）。矩阵不可逆（如缩放为 0）时为 undefined。
 */
function pose(node: HTMLElement, box: Size): Matrix<2, "affine"> | undefined {
  const inverse = frame(plane.multiply(linear(node), own(node)), rect(node), {
    matrix: plane.identity,
    size: box,
  });
  return inverse && plane.invert(inverse);
}

/**
 * 节点边框盒四个角在屏幕坐标里的多边形；旋转、斜切后依然精确，不是轴对齐包围盒。
 *
 * @param node 要测量的节点。
 * @returns 依次为左上、右上、右下、左下的屏幕点；变换不可逆时为 undefined。
 */
export function outline(node: HTMLElement): Polygon | undefined {
  const box = size(node);
  const matrix = pose(node, box);
  return matrix && corners({ matrix, size: box });
}

/**
 * 屏幕坐标到节点内容空间的仿射矩阵。内容空间以内边距盒左上为原点并已扣除滚动偏移，
 * 正是节点内绝对定位子元素所在的空间，例如在节点里画插入线。
 *
 * @param node 目标节点。
 * @returns 屏幕 → 内容空间的矩阵；变换不可逆时为 undefined。
 */
export function inward(node: HTMLElement): Matrix<2, "affine"> | undefined {
  const matrix = pose(node, size(node));
  const shift = plane.translate(
    node.clientLeft - node.scrollLeft,
    node.clientTop - node.scrollTop,
  );
  return matrix && plane.invert(plane.multiply(matrix, shift));
}

/**
 * 节点内边距盒（client 区域，不含边框与滚动条）在屏幕坐标里的多边形。
 *
 * @param node 目标节点。
 * @returns 依次为左上、右上、右下、左下的屏幕点；变换不可逆时为 undefined。
 */
export function client(node: HTMLElement): Polygon | undefined {
  const matrix = pose(node, size(node));
  return (
    matrix &&
    corners({
      matrix: plane.multiply(
        matrix,
        plane.translate(node.clientLeft, node.clientTop),
      ),
      size: { width: node.clientWidth, height: node.clientHeight },
    })
  );
}

/**
 * 读出节点 CSS `min-*`、`max-*` 在该轴上的像素约束，换算成边框盒尺寸；
 * 非像素值（如 `none`、`auto`、百分比）不产生约束。
 *
 * @param node 目标节点。
 * @param axis `"width"` 或 `"height"`。
 * @returns 该轴的取值范围，缺少的一端表示不限。
 */
export function range(node: HTMLElement, axis: Axis): Range {
  const style = getComputedStyle(node);
  const [low, high] =
    axis === "width"
      ? [style.minWidth, style.maxWidth]
      : [style.minHeight, style.maxHeight];
  const extra = inset(style, axis);
  return {
    ...(low.endsWith("px") ? { min: pixels(low) + extra } : {}),
    ...(high.endsWith("px") ? { max: pixels(high) + extra } : {}),
  };
}

/**
 * @file 参考线渲染：把线段画成宿主元素里的一层绝对定位元素。
 *
 * 对齐线画实线，间距段画虚线；线宽按宿主的累计缩放换算，在屏幕上保持固定像素。
 * 每个宿主最多一层参考线，图层与线段都不接收指针事件。
 */

import { plane } from "@openconsole/matrix";

import { scale, type Guide } from "../model";
import { linear, own } from "./measure";

/**
 * 每个宿主元素当前的参考线层；没有参考线时移除。
 *
 * 多个渲染函数共用一个宿主时共享这一层，后画的替换先画的。
 */
const layers = new WeakMap<Element, HTMLElement>();

/**
 * 把一段参考线画成一个元素：以起点为原点、沿线段方向旋转的细长条。
 *
 * 元素左端对齐起点、纵向居中于线段，`transform-origin` 设在左端中点，再按 `atan2` 求出的方向 `rotate`；
 * 长度为两端点的距离。颜色取 CSS 变量 `--guide`（缺省 `#f43f5e`）。
 * 间距段（`kind: "gap"`）用重复渐变画成虚线，虚线节长为线宽的 4 倍。
 *
 * @param document 用于创建元素的文档。
 * @param guide 线段，端点为宿主内绝对定位使用的坐标（宿主内边距盒，左上为原点）。
 * @param thickness 线宽，宿主空间里的像素。
 * @returns 绝对定位的线段元素，带 `data-kind`。
 */
function draw(
  document: Document,
  { kind, from, to }: Guide,
  thickness: number,
): HTMLElement {
  const element = document.createElement("div");
  const color = "var(--guide, #f43f5e)";
  const dash = 4 * thickness;
  element.dataset.kind = kind;
  Object.assign(element.style, {
    position: "absolute",
    left: `${from.x}px`,
    top: `${from.y - thickness / 2}px`,
    width: `${Math.hypot(to.x - from.x, to.y - from.y)}px`,
    height: `${thickness}px`,
    transformOrigin: `0 ${thickness / 2}px`,
    rotate: `${Math.atan2(to.y - from.y, to.x - from.x)}rad`,
    background:
      kind === "gap"
        ? `repeating-linear-gradient(to right, ${color} 0 ${dash}px, transparent ${dash}px ${2 * dash}px)`
        : color,
  });
  return element;
}

/**
 * 把屏幕上的线宽换算成宿主空间里的线宽：除以宿主的累计缩放（祖先链与自身变换的 `√|det|`）。
 *
 * @param element 宿主元素。
 * @param width 屏幕上的线宽（像素）。
 * @returns 宿主空间里的线宽；累计缩放为 0 或求不出时按不缩放处理，返回 `width`。
 */
function stroke(element: HTMLElement, width: number): number {
  const factor = scale(plane.multiply(linear(element), own(element)));
  return factor > 0 ? width / factor : width;
}

/**
 * 创建参考线渲染函数：每次调用用新的线段替换宿主里的参考线层，传入空数组时移除该层。
 *
 * 图层是 `position: absolute; inset: 0; pointer-events: none` 的 `<div>`，追加为宿主的最后一个子元素，
 * 带 `data-layer="guides"`，不会被当作条目或目标；颜色取 CSS 变量 `--guide`，每条线带 `data-kind`。
 * 线宽按宿主的累计缩放换算，使屏幕上恰为 `width` 个像素：每个渲染函数在从无到有显示参考线时换算一次，
 * 之后到清空前沿用，所以复用别的渲染函数建好的图层时也按自己的宽度换算。
 * 宿主不是 `HTMLElement`（如 `null`）时什么也不做。
 *
 * @param host 返回宿主元素的函数，每次渲染时调用；宿主应为线段坐标所在空间的定位元素，
 *   例如被拖节点的 offsetParent（`magnet` 的参考线在其容器空间里）。
 * @param width 屏幕上的线宽（像素），缺省为 1。
 * @returns `(lines) => void`，传入当前要显示的参考线。
 * @example
 * magnet(outlines(card, true, board), { onSnap: guides(() => card.offsetParent) });
 */
export function guides(
  host: () => Element | null,
  width = 1,
): (lines: readonly Guide[]) => void {
  /** 本渲染函数的线宽（宿主空间像素）；清空参考线后置空，下次显示时重新换算。 */
  let thickness: number | undefined;
  return (lines) => {
    const element = host();
    if (!(element instanceof HTMLElement)) return;
    let layer = layers.get(element);
    if (lines.length === 0) {
      layer?.remove();
      layers.delete(element);
      thickness = undefined;
      return;
    }
    if (!layer) {
      layer = element.ownerDocument.createElement("div");
      layer.dataset.layer = "guides";
      Object.assign(layer.style, {
        position: "absolute",
        inset: "0",
        pointerEvents: "none",
      });
      element.append(layer);
      layers.set(element, layer);
    }
    thickness ??= stroke(element, width);
    const current = thickness;
    layer.replaceChildren(
      ...lines.map((guide) => draw(element.ownerDocument, guide, current)),
    );
  };
}

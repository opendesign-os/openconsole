/**
 * @file 网格线插件：在容器里铺一层按步长重复的网格背景。
 *
 * 同一容器、同一步长只画一层，挂载该插件的绑定按引用计数共享，最后一个卸载时移除。
 * 网格层随插件挂载常驻显示，不随会话出现或消失；它只负责显示，吸附由 `grid` 插件完成。
 */

import type { Plugin } from "../core";

/** 一层网格线及其引用计数。 */
interface Layer {
  /** 网格线元素，带 `data-layer="grid"`，因而不会被当作条目或目标。 */
  readonly element: HTMLElement;
  /** 当前挂载这一层的插件数量，归零时移除元素。 */
  hosts: number;
}

/** 每个容器下按步长索引的网格线层：容器 → 步长（像素）→ 网格层。 */
const layers = new WeakMap<HTMLElement, Map<number, Layer>>();

/** 单条网格线的渐变色标：1px 宽、取 `currentColor` 15% 不透明度的浅色线，其余透明。 */
const line =
  "color-mix(in srgb, currentColor 15%, transparent) 1px, transparent 1px";

/**
 * 创建网格线插件：挂载（`onAttach`）时在容器最前面插入网格背景层，卸载（`onDetach`）时
 * 引用计数归零才移除。
 *
 * 网格层是 `position: absolute; inset: 0; pointer-events: none` 的 `<div>`，用横竖两组
 * `linear-gradient` 画线，插在容器最前面，因而绘制在其后定位或带变换的兄弟元素之下。容器应为定位元素，
 * 通常就是被拖节点的 offsetParent：`grid` 在它的内边距盒坐标里吸附，网格线与吸附点才对得上。
 *
 * @param container 铺网格的容器，网格从其内边距盒左上角开始。
 * @param step 网格步长（像素），与 `grid` 插件的步长一致时线与吸附点重合。
 * @returns 只实现 `onAttach` 与 `onDetach` 的插件。
 * @example
 * bind(card, {
 *   action: transform({ translate: true }),
 *   plugins: [grid(20), gridlines(board, 20)],
 * });
 */
export function gridlines(container: HTMLElement, step: number): Plugin {
  return {
    /** 已有同步长的层时只加引用计数，否则创建网格层并插到容器最前面。 */
    onAttach: () => {
      const shared = layers.get(container) ?? new Map<number, Layer>();
      layers.set(container, shared);
      const layer = shared.get(step);
      if (layer) {
        layer.hosts += 1;
        return;
      }
      const element = container.ownerDocument.createElement("div");
      element.dataset.layer = "grid";
      Object.assign(element.style, {
        position: "absolute",
        inset: "0",
        pointerEvents: "none",
        backgroundImage: `linear-gradient(to right, ${line}), linear-gradient(to bottom, ${line})`,
        backgroundSize: `${step}px ${step}px`,
      });
      container.prepend(element);
      shared.set(step, { element, hosts: 1 });
    },
    /** 减少引用计数，最后一个挂载者离开时移除网格层。 */
    onDetach: () => {
      const shared = layers.get(container);
      const layer = shared?.get(step);
      if (!shared || !layer) return;
      layer.hosts -= 1;
      if (layer.hosts > 0) return;
      layer.element.remove();
      shared.delete(step);
    },
  };
}

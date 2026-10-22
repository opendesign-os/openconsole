/**
 * @file 拖进或拖出容器的插件：拖动时高亮指针下最内层的可放入容器，松手时把节点移交过去。
 */

import { hotspot, type Plugin } from "../core";
import { probe } from "./targets";
import { transfer } from "./view";

/**
 * 创建嵌套插件。
 *
 * 会话开始时量取 `root` 及其中匹配 `selector` 的容器（不含被拖节点自身与后代）。移动时用拖拽热点
 * （指针，键盘拖动时为节点中心）找出最内层的容器并高亮：加 `data-over`，描边取 CSS 变量 `--over`；
 * 节点当前的父元素不高亮。松手时用 {@link transfer} 移入高亮的容器，屏幕上的位置、旋转与尺寸不变；
 * 取消时只清除高亮。
 *
 * @param node 被拖节点。
 * @param root 可放入的最外层容器；指针在其中但不在任何匹配容器里时以它为目标。
 * @param selector 可放入容器的 CSS 选择器，在 `root` 里任意层级查找。
 * @returns 插件。
 * @example
 * bind(card, {
 *   action: transform({ translate: true }),
 *   plugins: [nest(card, board, ".group")],
 * });
 */
export function nest(
  node: HTMLElement,
  root: HTMLElement,
  selector: string,
): Plugin {
  /** 命中函数，会话开始时按当时的布局重建。 */
  let find = probe([], node);
  let target: HTMLElement | undefined;
  /** 高亮前目标容器的内联 `outline`，取消高亮时还原。 */
  let previous = "";
  /** 切换高亮目标：还原上一个目标的描边与 `data-over`，再标记新的目标。 */
  const highlight = (next: HTMLElement | undefined) => {
    if (next === target) return;
    if (target) {
      delete target.dataset["over"];
      target.style.outline = previous;
    }
    target = next;
    if (target) {
      target.dataset["over"] = "";
      previous = target.style.outline;
      target.style.outline = "var(--over, 2px dashed currentColor)";
    }
  };
  return {
    onStart: () => {
      find = probe([root, ...root.querySelectorAll(selector)], node);
    },
    onMove: (context) => {
      const point = hotspot(context);
      if (!point) return undefined;
      const next = find(point);
      highlight(next === node.parentElement ? undefined : next);
      return undefined;
    },
    onEnd: () => {
      const next = target;
      highlight(undefined);
      if (next) transfer(node, next);
    },
    onCancel: () => highlight(undefined),
  };
}

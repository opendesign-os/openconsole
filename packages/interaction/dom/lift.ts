/**
 * @file lift 插件：拖动期间把节点抬到兄弟之上，结束或取消时恢复。
 */

import type { Plugin } from "../core";

/**
 * 抬高节点：`z-index` 设为 1，静态定位时改为 `relative` 使其生效。
 *
 * 给出 `root` 时，节点与 `root` 之间已定位的祖先一起抬高，避免节点被祖先的兄弟遮住。
 * @param node 要抬高的节点。
 * @param root 抬高祖先的上界（不含）；缺省时只抬高节点本身。
 * @returns 恢复原有 `position` 与 `z-index` 的函数。
 */
function raise(node: HTMLElement, root?: Element): () => void {
  const raised = [node];
  if (root?.contains(node)) {
    for (
      let parent = node.parentElement;
      parent && parent !== root;
      parent = parent.parentElement
    ) {
      if (getComputedStyle(parent).position !== "static") raised.push(parent);
    }
  }
  const saved = raised.map((element) => ({
    element,
    position: element.style.position,
    zIndex: element.style.zIndex,
  }));
  if (getComputedStyle(node).position === "static") {
    node.style.position = "relative";
  }
  for (const element of raised) element.style.zIndex = "1";
  return () => {
    for (const { element, position, zIndex } of saved) {
      element.style.position = position;
      element.style.zIndex = zIndex;
    }
  };
}

/**
 * 拖动期间抬高节点的插件：会话开始时抬高，结束或取消时恢复。
 * @param node 被拖动的节点。
 * @param root 抬高祖先的上界（不含）；缺省时只抬高节点本身。
 * @returns 插件。
 * @example
 * bind(node, { action: transform({ translate: true }), plugins: [lift(node, board)] });
 */
export function lift(node: HTMLElement, root?: Element): Plugin {
  let undo: (() => void) | undefined;
  const lower = () => {
    undo?.();
    undo = undefined;
  };
  return {
    onStart: () => {
      undo = raise(node, root);
    },
    onEnd: lower,
    onCancel: lower,
  };
}

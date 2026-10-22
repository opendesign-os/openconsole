import type { Plugin } from "../core";

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

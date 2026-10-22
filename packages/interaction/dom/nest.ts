import { hotspot, type Plugin } from "../core";
import { probe } from "./targets";
import { transfer } from "./view";

export function nest(
  node: HTMLElement,
  root: HTMLElement,
  selector: string,
): Plugin {
  let find = probe([], node);
  let target: HTMLElement | undefined;
  let previous = "";
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

import { plane } from "@openconsole/matrix";

import { choose, type Plugin } from "../core";
import { center, centroid, contains, type Polygon } from "../model";
import { outline } from "./measure";
import { transfer } from "./view";

interface Candidate {
  readonly element: HTMLElement;
  readonly polygon: Polygon;
}

export function nest(
  node: HTMLElement,
  root: HTMLElement,
  selector: string,
): Plugin {
  let candidates: Candidate[] = [];
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
      candidates = [root, ...root.querySelectorAll(selector)].flatMap(
        (element) => {
          if (!(element instanceof HTMLElement) || node.contains(element)) {
            return [];
          }
          const polygon = outline(element);
          return polygon ? [{ element, polygon }] : [];
        },
      );
    },
    onMove: ({ state, frame, input }) => {
      const inverse = plane.invert(frame);
      const point =
        input.points.length > 0
          ? centroid(input.points)
          : inverse && plane.apply(inverse, center(state));
      if (!point) return undefined;
      const inside = candidates.flatMap(({ element, polygon }) =>
        contains(polygon, point) ? [{ target: element, score: 0 }] : [],
      );
      const next = choose(inside, (outer, inner) => outer.contains(inner));
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

import { plane, type Point } from "@openconsole/matrix";

import { choose, type Context } from "../core";
import { contains, type Polygon } from "../model";
import { outline } from "./measure";

export const layered = (element: Element): boolean =>
  element instanceof HTMLElement && element.dataset["layer"] !== undefined;

export const query = (
  root: ParentNode,
  selector = ":scope > *",
): HTMLElement[] =>
  [...root.querySelectorAll(selector)].flatMap((element) =>
    element instanceof HTMLElement && !layered(element) ? [element] : [],
  );

function select(
  node: HTMLElement,
  value: true | string,
  root: ParentNode,
): Element[] {
  if (typeof value === "string") return [...root.querySelectorAll(value)];
  const parent = node.parentElement;
  if (!parent) return [];
  return [parent, ...[...parent.children].filter((child) => !layered(child))];
}

export const outlines =
  (node: HTMLElement, value: true | string, root: ParentNode) =>
  (context: Pick<Context, "frame">): Polygon[] =>
    select(node, value, root).flatMap((element) => {
      if (node.contains(element) || !(element instanceof HTMLElement)) {
        return [];
      }
      const polygon = outline(element);
      if (!polygon) return [];
      return [polygon.map((point) => plane.apply(context.frame, point))];
    });

export function probe(
  elements: Iterable<Element>,
  node: HTMLElement,
): (point: Point<2>) => HTMLElement | undefined {
  const areas = [...elements].flatMap((target) => {
    if (!(target instanceof HTMLElement) || node.contains(target)) return [];
    const polygon = outline(target);
    return polygon ? [{ target, polygon }] : [];
  });
  return (point) =>
    choose(
      areas.flatMap(({ target, polygon }) =>
        contains(polygon, point) ? [{ target, score: 0 }] : [],
      ),
      (outer, inner) => outer.contains(inner),
    );
}

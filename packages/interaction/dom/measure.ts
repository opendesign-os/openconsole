import { plane, type Matrix, type Point } from "@openconsole/matrix";

import { choose, frame, type Context } from "../core";
import {
  contains,
  corners,
  type Bounds,
  type Polygon,
  type Range,
  type Size,
} from "../model";
import { local, type Computed } from "./style";

type Axis = "width" | "height";

const pixels = (value: string): number => Number.parseFloat(value) || 0;

function parent(element: Element): Element | null {
  if (element.assignedSlot) return element.assignedSlot;
  if (element.parentElement) return element.parentElement;
  const root = element.parentNode;
  return root instanceof ShadowRoot ? root.host : null;
}

export function linear(node: Element): Matrix<2, "affine"> {
  let chain: Matrix<2, "affine"> = plane.identity;
  for (let element = parent(node); element; element = parent(element)) {
    const style = getComputedStyle(element);
    if (style.display === "inline" || style.display === "contents") continue;
    chain = plane.multiply(local(style), chain);
  }
  return chain;
}

export const own = (node: Element): Matrix<2, "affine"> =>
  local(getComputedStyle(node));

export function rect(node: Element): Bounds {
  const { left, top, right, bottom } = node.getBoundingClientRect();
  return { left, top, right, bottom };
}

export const box = (node: HTMLElement): Bounds => ({
  left: node.offsetLeft,
  top: node.offsetTop,
  right: node.offsetLeft + node.offsetWidth,
  bottom: node.offsetTop + node.offsetHeight,
});

export const offset = (node: HTMLElement): Point<2> => ({
  x: node.offsetLeft,
  y: node.offsetTop,
});

export const rendered = (node: Element): boolean =>
  node.isConnected && node.getClientRects().length > 0;

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

export function size(node: HTMLElement): Size {
  const style = getComputedStyle(node);
  return {
    width: pixels(style.width) + inset(style, "width"),
    height: pixels(style.height) + inset(style, "height"),
  };
}

export function write(node: HTMLElement, size: Size): void {
  const style = getComputedStyle(node);
  node.style.width = `${Math.max(0, size.width - inset(style, "width"))}px`;
  node.style.height = `${Math.max(0, size.height - inset(style, "height"))}px`;
}

export function intrinsic(node: HTMLElement, width: number): number {
  const saved = { width: node.style.width, height: node.style.height };
  const extra = inset(getComputedStyle(node), "width");
  node.style.width = `${Math.max(0, width - extra)}px`;
  node.style.height = "auto";
  const { height } = size(node);
  Object.assign(node.style, saved);
  return height;
}

function pose(node: HTMLElement, box: Size): Matrix<2, "affine"> | undefined {
  const inverse = frame(plane.multiply(linear(node), own(node)), rect(node), {
    matrix: plane.identity,
    size: box,
  });
  return inverse && plane.invert(inverse);
}

export function outline(node: HTMLElement): Polygon | undefined {
  const box = size(node);
  const matrix = pose(node, box);
  return matrix && corners({ matrix, size: box });
}

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

export function inward(node: HTMLElement): Matrix<2, "affine"> | undefined {
  const matrix = pose(node, size(node));
  const shift = plane.translate(
    node.clientLeft - node.scrollLeft,
    node.clientTop - node.scrollTop,
  );
  return matrix && plane.invert(plane.multiply(matrix, shift));
}

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

export const layered = (element: Element): boolean =>
  element instanceof HTMLElement && element.dataset["layer"] !== undefined;

export const query = (
  root: ParentNode,
  selector = ":scope > *",
): HTMLElement[] =>
  [...root.querySelectorAll(selector)].flatMap((element) =>
    element instanceof HTMLElement && !layered(element) ? [element] : [],
  );

function targets(
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
    targets(node, value, root).flatMap((element) => {
      if (node.contains(element) || !(element instanceof HTMLElement)) {
        return [];
      }
      const polygon = outline(element);
      if (!polygon) return [];
      return [polygon.map((point) => plane.apply(context.frame, point))];
    });

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

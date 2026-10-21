import { plane, type Matrix, type Point } from "@openconsole/matrix";

import type { Bounds, Range, Size } from "../core";
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

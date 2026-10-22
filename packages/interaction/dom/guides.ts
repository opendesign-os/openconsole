import { plane } from "@openconsole/matrix";

import { scale, type Guide } from "../model";
import { linear, own } from "./measure";

const layers = new WeakMap<Element, HTMLElement>();

function draw(
  document: Document,
  { kind, from, to }: Guide,
  thickness: number,
): HTMLElement {
  const element = document.createElement("div");
  const color = "var(--guide, #f43f5e)";
  const dash = 4 * thickness;
  element.dataset["kind"] = kind;
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

export function guides(
  host: () => Element | null,
  width = 1,
): (lines: readonly Guide[]) => void {
  let thickness = width;
  return (lines) => {
    const element = host();
    if (!(element instanceof HTMLElement)) return;
    let layer = layers.get(element);
    if (lines.length === 0) {
      layer?.remove();
      layers.delete(element);
      return;
    }
    if (!layer) {
      layer = element.ownerDocument.createElement("div");
      layer.dataset["layer"] = "guides";
      Object.assign(layer.style, {
        position: "absolute",
        inset: "0",
        pointerEvents: "none",
      });
      element.append(layer);
      layers.set(element, layer);
      thickness =
        width / scale(plane.multiply(linear(element), own(element))) || width;
    }
    layer.replaceChildren(
      ...lines.map((guide) => draw(element.ownerDocument, guide, thickness)),
    );
  };
}

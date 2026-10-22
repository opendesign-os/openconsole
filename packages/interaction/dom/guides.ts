import { plane } from "@openconsole/matrix";

import type { Guide } from "../model";
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
  target: () => Element | null,
  width = 1,
): (lines: readonly Guide[]) => void {
  let thickness = width;
  return (lines) => {
    const host = target();
    if (!(host instanceof HTMLElement)) return;
    let layer = layers.get(host);
    if (lines.length === 0) {
      layer?.remove();
      layers.delete(host);
      return;
    }
    if (!layer) {
      layer = host.ownerDocument.createElement("div");
      layer.dataset["layer"] = "guides";
      Object.assign(layer.style, {
        position: "absolute",
        inset: "0",
        pointerEvents: "none",
      });
      host.append(layer);
      layers.set(host, layer);
      const [a, b, c, d] = plane.multiply(linear(host), own(host));
      thickness = width / Math.sqrt(Math.abs(a * d - b * c)) || width;
    }
    layer.replaceChildren(
      ...lines.map((guide) => draw(host.ownerDocument, guide, thickness)),
    );
  };
}

import type { Plugin } from "../core/tracker";

interface Layer {
  readonly element: HTMLElement;
  hosts: number;
}

const layers = new WeakMap<HTMLElement, Map<number, Layer>>();

const line =
  "color-mix(in srgb, currentColor 15%, transparent) 1px, transparent 1px";

export function gridlines(container: HTMLElement, step: number): Plugin {
  return {
    onAttach: () => {
      let shared = layers.get(container);
      if (!shared) {
        shared = new Map();
        layers.set(container, shared);
      }
      const layer = shared.get(step);
      if (layer) {
        layer.hosts += 1;
        return;
      }
      const element = container.ownerDocument.createElement("div");
      element.style.cssText = `position:absolute;inset:0;pointer-events:none;background:linear-gradient(to right,${line}),linear-gradient(to bottom,${line});background-size:${step}px ${step}px`;
      container.prepend(element);
      shared.set(step, { element, hosts: 1 });
    },
    onDetach: () => {
      const shared = layers.get(container);
      const layer = shared?.get(step);
      if (!shared || !layer) return;
      layer.hosts -= 1;
      if (layer.hosts > 0) return;
      layer.element.remove();
      shared.delete(step);
    },
  };
}

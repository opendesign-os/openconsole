import { resize, type Handle } from "../core";
import {
  bind,
  grips,
  guides,
  outlines,
  range,
  region,
  View,
  type Binding,
  type BindOptions,
} from "../dom";
import { Shape, type CapabilityOptions, type Part, type Range } from "../model";
import { bounds, collide, limits, magnet } from "../plugins";

export interface ResizableOptions
  extends Omit<BindOptions, "action" | "handle" | "keys">, CapabilityOptions {
  readonly handles?: ReadonlyMap<Element, Handle>;
  readonly symmetric?: boolean;
  readonly width?: Range;
  readonly height?: Range;
  readonly container?: HTMLElement;
  readonly magnet?: boolean | string;
  readonly collide?: boolean | string;
}

function narrow(outer: Range = {}, inner: Range): Range {
  const min = Math.max(outer.min ?? 0, inner.min ?? 0);
  const max = Math.min(outer.max ?? Infinity, inner.max ?? Infinity);
  return { min, ...(Number.isFinite(max) ? { max } : {}) };
}

export class Resizable extends Shape<HTMLElement, ResizableOptions> {
  constructor(node: HTMLElement, options: ResizableOptions = {}) {
    super(node, View.of(node).store, options);
    this.refresh();
  }

  protected build(): readonly Part[] {
    const { handles } = this.options;
    if (handles) return this.#bind(handles);
    const created = grips(this.node);
    return [
      ...this.#bind(created),
      () => {
        for (const grip of created.keys()) grip.remove();
      },
    ];
  }

  #bind(handles: ReadonlyMap<Element, Handle>): Binding[] {
    const { node, options } = this;
    const { symmetric = false, container, plugins = [] } = options;
    const scope = container ?? node.ownerDocument;
    const limit = limits({
      width: narrow(options.width, range(node, "width")),
      height: narrow(options.height, range(node, "height")),
    });
    return [...handles].map(([handle, side]) =>
      bind(node, {
        ...options,
        handle,
        action: resize({ handle: side, symmetric }),
        plugins: [
          options.magnet
            ? magnet(outlines(node, options.magnet, scope), {
                onSnap: guides(() => node.offsetParent),
              })
            : undefined,
          ...plugins,
          container && bounds(region(container, node)),
          limit,
          options.collide
            ? collide(outlines(node, options.collide, scope))
            : undefined,
        ].filter((plugin) => plugin !== undefined),
      }),
    );
  }
}

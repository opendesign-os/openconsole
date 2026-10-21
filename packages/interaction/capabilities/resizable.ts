import { resize, type Handle } from "../core";
import { area, bind, range, View, type BindOptions } from "../dom";
import { Shape, type CapabilityOptions, type Part, type Range } from "../model";
import { bounds, limits } from "../plugins";

export interface ResizableOptions
  extends Omit<BindOptions, "action" | "handle" | "keys">, CapabilityOptions {
  readonly handles: ReadonlyMap<Element, Handle>;
  readonly symmetric?: boolean;
  readonly width?: Range;
  readonly height?: Range;
  readonly container?: HTMLElement;
}

function narrow(outer: Range = {}, inner: Range): Range {
  const min = Math.max(outer.min ?? 0, inner.min ?? 0);
  const max = Math.min(outer.max ?? Infinity, inner.max ?? Infinity);
  return { min, ...(Number.isFinite(max) ? { max } : {}) };
}

export class Resizable extends Shape<HTMLElement, ResizableOptions> {
  constructor(node: HTMLElement, options: ResizableOptions) {
    super(node, View.of(node).store, options);
    this.refresh();
  }

  protected build(): readonly Part[] {
    const { node } = this;
    const {
      handles,
      symmetric = false,
      container,
      plugins = [],
    } = this.options;
    const limit = limits({
      width: narrow(this.options.width, range(node, "width")),
      height: narrow(this.options.height, range(node, "height")),
    });
    return [...handles].map(([handle, side]) =>
      bind(node, {
        ...this.options,
        handle,
        action: resize({ handle: side, symmetric }),
        plugins: [
          ...plugins,
          ...(container ? [bounds(area(container))] : []),
          limit,
        ],
      }),
    );
  }
}

import { resize, type Handle, type Range, type State } from "../core";
import { bind, range, type Binding, type BindOptions } from "../dom";
import { bounds, limits } from "../plugins";

export interface ResizableOptions extends Omit<
  BindOptions,
  "action" | "handle" | "keys"
> {
  readonly handles: ReadonlyMap<Element, Handle>;
  readonly symmetric?: boolean;
  readonly width?: Range;
  readonly height?: Range;
  readonly container?: HTMLElement;
}

function narrow(outer: Range, inner: Range): Range {
  const min = Math.max(outer.min ?? 0, inner.min ?? 0);
  const max = Math.min(outer.max ?? Infinity, inner.max ?? Infinity);
  return { min, ...(Number.isFinite(max) ? { max } : {}) };
}

export class Resizable {
  readonly node: HTMLElement;
  readonly #bindings: readonly Binding[];
  readonly #first: Binding;

  constructor(node: HTMLElement, options: ResizableOptions) {
    const { handles, symmetric = false, container, plugins = [] } = options;
    const limit = limits({
      width: narrow(options.width ?? {}, range(node, "width")),
      height: narrow(options.height ?? {}, range(node, "height")),
    });
    const area = container
      ? [
          bounds(() => ({
            left: 0,
            top: 0,
            right: container.clientWidth,
            bottom: container.clientHeight,
          })),
        ]
      : [];
    const bindings = [...handles].map(([handle, side]) =>
      bind(node, {
        ...options,
        handle,
        action: resize({ handle: side, symmetric }),
        plugins: [...plugins, ...area, limit],
      }),
    );
    const [first] = bindings;
    if (!first) throw new RangeError("expected at least one handle");
    this.node = node;
    this.#bindings = bindings;
    this.#first = first;
  }

  get state(): State {
    return this.#first.state;
  }

  get active(): boolean {
    return this.#bindings.some((binding) => binding.active);
  }

  update(options: Pick<ResizableOptions, "matrix" | "size">): this {
    this.#first.update(options);
    return this;
  }

  destroy(): this {
    for (const binding of this.#bindings) binding.destroy();
    return this;
  }

  [Symbol.dispose](): void {
    this.destroy();
  }
}

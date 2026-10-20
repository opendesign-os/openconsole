import { plane, type Point } from "@openconsole/matrix";

import {
  center,
  transform,
  type Bounds,
  type Plugin,
  type State,
  type Step,
} from "../core";
import {
  bind,
  box,
  linear,
  type Activation,
  type Binding,
  type BindOptions,
  type Keys,
} from "../dom";

export interface Place {
  readonly list: HTMLElement;
  readonly index: number;
}

export interface Sort {
  readonly item: HTMLElement;
  readonly from: Place;
  readonly to: Place;
}

export type Slot = (point: Point<2>, boxes: readonly Bounds[]) => number;

export interface SortableOptions extends Omit<
  BindOptions,
  "action" | "handle" | "ignore" | "keys" | "matrix" | "size" | "index"
> {
  readonly items?: string;
  readonly handle?: string;
  readonly ignore?: string;
  readonly slot?: Slot;
  readonly duration?: number;
  readonly onSort?: (sort: Sort) => void;
}

export const closest: Slot = (point, boxes) => {
  let index = -1;
  let nearest = Infinity;
  boxes.forEach((bounds, position) => {
    const distance = Math.hypot(
      (bounds.left + bounds.right) / 2 - point.x,
      (bounds.top + bounds.bottom) / 2 - point.y,
    );
    if (distance < nearest) {
      nearest = distance;
      index = position;
    }
  });
  return index;
};

const select = (item: HTMLElement, selector: string | undefined) =>
  selector ? [...item.querySelectorAll(selector)] : [];

const activation = (type: string): Activation =>
  type === "touch" ? { delay: 250, tolerance: 5 } : { distance: 3 };

function record(elements: readonly HTMLElement[]): Map<HTMLElement, DOMRect> {
  return new Map(
    elements.map((element): [HTMLElement, DOMRect] => [
      element,
      element.getBoundingClientRect(),
    ]),
  );
}

function play(rects: Map<HTMLElement, DOMRect>, duration: number): void {
  if (duration <= 0) return;
  for (const [element, before] of rects) {
    const after = element.getBoundingClientRect();
    const inverse = plane.invert(linear(element));
    if (!inverse) continue;
    const shift = plane.apply(inverse, {
      x: before.left - after.left,
      y: before.top - after.top,
    });
    if (Math.hypot(shift.x, shift.y) < 0.5) continue;
    element.animate(
      [{ translate: `${shift.x}px ${shift.y}px` }, { translate: "0px 0px" }],
      { duration, easing: "ease" },
    );
  }
}

export class Sortable {
  readonly node: HTMLElement;
  readonly #options: SortableOptions;
  readonly #bindings = new Map<HTMLElement, Binding>();

  constructor(list: HTMLElement, options: SortableOptions = {}) {
    this.node = list;
    this.#options = options;
    this.refresh();
  }

  get items(): HTMLElement[] {
    const selector = this.#options.items ?? ":scope > *";
    return [...this.node.querySelectorAll(selector)].filter(
      (element) => element instanceof HTMLElement,
    );
  }

  refresh(): this {
    const items = this.items;
    for (const [item, binding] of this.#bindings) {
      if (items.includes(item)) continue;
      binding.destroy();
      this.#bindings.delete(item);
    }
    items.forEach((item, index) => {
      const binding = this.#bindings.get(item);
      if (binding) binding.update({ index });
      else this.#bindings.set(item, this.#bind(item, index));
    });
    return this;
  }

  move(item: HTMLElement, index: number): this {
    const from = this.items.indexOf(item);
    if ([...this.#bindings.values()].some((binding) => binding.active)) {
      return this;
    }
    if (!this.#reorder(item, index)) return this;
    this.refresh();
    this.#announce(item, from);
    return this;
  }

  destroy(): this {
    for (const binding of this.#bindings.values()) binding.destroy();
    this.#bindings.clear();
    return this;
  }

  [Symbol.dispose](): void {
    this.destroy();
  }

  #bind(item: HTMLElement, index: number): Binding {
    const { handle, ignore, plugins = [] } = this.#options;
    return bind(item, {
      activation,
      ...this.#options,
      handle: select(item, handle),
      ignore: select(item, ignore),
      action: transform({ translate: true }),
      plugins: [this.#slot(), ...plugins, this.#apply(item)],
      keys: this.#keys(item),
      index,
    });
  }

  #slot(): Plugin {
    return {
      onMove: ({ state }) => {
        const index = (this.#options.slot ?? closest)(
          center(state),
          this.items.map(box),
        );
        return index < 0 ? undefined : { ...state, index };
      },
    };
  }

  #apply(item: HTMLElement): Plugin {
    let from = -1;
    let layer: { position: string; zIndex: string } | undefined;
    const lift = () => {
      layer = { position: item.style.position, zIndex: item.style.zIndex };
      if (getComputedStyle(item).position === "static") {
        item.style.position = "relative";
      }
      item.style.zIndex = "1";
    };
    const drop = () => {
      if (!layer) return;
      item.style.position = layer.position;
      item.style.zIndex = layer.zIndex;
      layer = undefined;
    };
    const settle = (restore: boolean) => {
      const start = from;
      from = -1;
      if (restore) this.#reorder(item, start);
      const before = record([item]);
      const binding = this.#bindings.get(item);
      binding?.relayout();
      binding?.update({
        matrix: plane.translate(item.offsetLeft, item.offsetTop),
      });
      play(before, this.#options.duration ?? 150);
      drop();
      this.refresh();
      if (!restore) this.#announce(item, start);
    };
    return {
      onStart: () => {
        from = this.items.indexOf(item);
        lift();
      },
      onChange: ({ state }) => {
        if (from < 0 || state.index === undefined) return;
        if (this.#reorder(item, state.index)) {
          this.#bindings.get(item)?.relayout();
        }
      },
      onEnd: () => settle(false),
      onCancel: () => settle(true),
    };
  }

  #keys(item: HTMLElement): Keys {
    const step =
      (offset: number) =>
      (state: State): Step | undefined => {
        const items = this.items;
        const target = items[items.indexOf(item) + offset];
        if (!target) return undefined;
        const bounds = box(target);
        const middle = center(state);
        return {
          matrix: plane.translate(
            (bounds.left + bounds.right) / 2 - middle.x,
            (bounds.top + bounds.bottom) / 2 - middle.y,
          ),
          space: "container",
        };
      };
    return {
      ArrowUp: step(-1),
      ArrowLeft: step(-1),
      ArrowDown: step(1),
      ArrowRight: step(1),
    };
  }

  #reorder(item: HTMLElement, index: number): boolean {
    const items = this.items;
    const current = items.indexOf(item);
    if (current < 0 || index < 0 || index >= items.length) return false;
    if (index === current) return false;
    const siblings = items.filter((element) => element !== item);
    const rects = record(siblings);
    if (index > current) {
      for (const sibling of items.slice(current + 1, index + 1)) {
        item.before(sibling);
      }
    } else {
      for (const sibling of items.slice(index, current).reverse()) {
        item.after(sibling);
      }
    }
    play(rects, this.#options.duration ?? 150);
    return true;
  }

  #announce(item: HTMLElement, from: number): void {
    const to = this.items.indexOf(item);
    if (from < 0 || to < 0 || from === to) return;
    this.#options.onSort?.({
      item,
      from: { list: this.node, index: from },
      to: { list: this.node, index: to },
    });
  }
}

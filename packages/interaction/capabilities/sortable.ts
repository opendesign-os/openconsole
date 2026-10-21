import { plane } from "@openconsole/matrix";

import {
  arrange,
  closest,
  transform,
  type Plugin,
  type Slot,
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
import {
  Capability,
  center,
  type CapabilityOptions,
  type Part,
  type State,
} from "../model";

export interface Place {
  readonly list: HTMLElement;
  readonly index: number;
}

export interface Sort {
  readonly item: HTMLElement;
  readonly from: Place;
  readonly to: Place;
}

export interface SortableOptions
  extends
    Omit<BindOptions, "action" | "handle" | "ignore" | "keys">,
    CapabilityOptions {
  readonly items?: string;
  readonly handle?: string;
  readonly ignore?: string;
  readonly slot?: Slot;
  readonly duration?: number;
  readonly onSort?: (sort: Sort) => void;
}

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

export class Sortable extends Capability<
  HTMLElement,
  SortableOptions,
  Binding
> {
  constructor(list: HTMLElement, options: SortableOptions = {}) {
    super(list, options);
    this.refresh();
  }

  get items(): HTMLElement[] {
    const selector = this.options.items ?? ":scope > *";
    return [...this.node.querySelectorAll(selector)].filter(
      (element) => element instanceof HTMLElement,
    );
  }

  move(item: HTMLElement, index: number): this {
    const from = this.items.indexOf(item);
    if (this.active || !this.#reorder(item, index)) return this;
    this.#index();
    this.#announce(item, from);
    return this;
  }

  protected build(): readonly Part<Binding>[] {
    const { handle, ignore, plugins = [] } = this.options;
    return this.items.map((item, index) =>
      bind(item, {
        activation,
        ...this.options,
        handle: select(item, handle),
        ignore: select(item, ignore),
        action: transform({ translate: true }),
        plugins: [this.#slot(), ...plugins, this.#apply(item)],
        keys: this.#keys(item),
      }).assign({ index }),
    );
  }

  #slot(): Plugin {
    return {
      onMove: ({ state }) => {
        const index = (this.options.slot ?? closest)(
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
      const binding = this.#binding(item);
      binding?.relayout();
      binding?.assign({
        matrix: plane.translate(item.offsetLeft, item.offsetTop),
      });
      play(before, this.options.duration ?? 150);
      drop();
      this.#index();
      if (!restore) this.#announce(item, start);
    };
    return {
      onStart: () => {
        from = this.items.indexOf(item);
        lift();
      },
      onChange: ({ state }) => {
        if (from < 0 || state.index === undefined) return;
        if (this.#reorder(item, state.index)) this.#binding(item)?.relayout();
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
    const rects = record(items.filter((element) => element !== item));
    const { before, after } = arrange(current, index);
    const nodes = (positions: readonly number[]) =>
      positions.flatMap((position) => items[position] ?? []);
    item.before(...nodes(before));
    item.after(...nodes(after));
    play(rects, this.options.duration ?? 150);
    return true;
  }

  #binding(item: HTMLElement): Binding | undefined {
    return this.units.find((binding) => binding.node === item);
  }

  #index(): void {
    const items = this.items;
    for (const binding of this.units) {
      binding.assign({ index: items.indexOf(binding.node) });
    }
  }

  #announce(item: HTMLElement, from: number): void {
    const to = this.items.indexOf(item);
    if (from < 0 || to < 0 || from === to) return;
    this.options.onSort?.({
      item,
      from: { list: this.node, index: from },
      to: { list: this.node, index: to },
    });
  }
}

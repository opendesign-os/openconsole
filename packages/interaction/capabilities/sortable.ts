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
  deliberate,
  play,
  raise,
  record,
  restore,
  View,
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
    const { plugins = [] } = this.options;
    return this.items.map((item, index) =>
      bind(item, {
        activation: deliberate,
        ...this.options,
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
    let lower: (() => void) | undefined;
    const settle = (back: boolean) => {
      const start = from;
      from = -1;
      if (back) this.#reorder(item, start);
      restore(item, this.options.duration ?? 150);
      lower?.();
      lower = undefined;
      this.#index();
      if (!back) this.#announce(item, start);
    };
    return {
      onStart: () => {
        from = this.items.indexOf(item);
        lower = raise(item);
      },
      onChange: ({ state }) => {
        if (from < 0 || state.index === undefined) return;
        if (this.#reorder(item, state.index)) View.of(item).relayout();
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

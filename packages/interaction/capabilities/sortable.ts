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
  lift,
  play,
  query,
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

export interface ListOptions
  extends
    Omit<BindOptions, "action" | "handle" | "ignore" | "keys">,
    CapabilityOptions {
  readonly items?: string;
  readonly handle?: string;
  readonly ignore?: string;
  readonly duration?: number;
}

export interface SortableOptions extends ListOptions {
  readonly slot?: Slot;
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
    return query(this.node, this.options.items);
  }

  move(item: HTMLElement, index: number): this {
    const from = this.items.indexOf(item);
    if (this.active || !this.#reorder(item, index)) return this;
    this.#index();
    this.#announce(item, from);
    return this;
  }

  protected build(): readonly Part<Binding>[] {
    return this.items.map((item, index) =>
      bind(item, this.#config(item)).assign({ index }),
    );
  }

  protected apply(changes: Partial<SortableOptions>): boolean {
    if ("items" in changes) return false;
    for (const binding of this.units) {
      binding.update(this.#config(binding.node));
    }
    return true;
  }

  #config(item: HTMLElement): BindOptions {
    const { plugins = [] } = this.options;
    return {
      activation: deliberate,
      ...this.options,
      action: transform({ translate: true }),
      plugins: [this.#slot(), ...plugins, lift(item), this.#track(item)],
      keys: this.#keys(item),
    };
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

  #track(item: HTMLElement): Plugin {
    let from = -1;
    const finish = (back: boolean) => {
      const start = from;
      from = -1;
      if (back) this.#reorder(item, start);
      restore(item, this.options.duration);
      this.#index();
      if (!back) this.#announce(item, start);
    };
    return {
      onStart: () => {
        from = this.items.indexOf(item);
      },
      onChange: ({ state }) => {
        if (from < 0 || state.index === undefined) return;
        if (this.#reorder(item, state.index)) View.of(item).relayout();
      },
      onEnd: () => finish(false),
      onCancel: () => finish(true),
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
    play(rects, this.options.duration);
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

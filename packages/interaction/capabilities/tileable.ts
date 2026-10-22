import { plane } from "@openconsole/matrix";

import {
  bottom,
  equal,
  place,
  resize,
  same,
  settle,
  transform,
  vacant,
  type Handle,
  type Layout,
  type Plugin,
  type Tile,
  type Tiling,
} from "../core";
import {
  arrows,
  bind,
  deliberate,
  grips,
  intrinsic,
  lift,
  play,
  query,
  record,
  View,
  type Binding,
} from "../dom";
import {
  Capability,
  epsilon,
  merge,
  type Part,
  type Patch,
  type State,
} from "../model";
import { limits } from "../plugins";
import type { ListOptions } from "./sortable";

export interface TileableOptions extends ListOptions, Omit<Tiling, "columns"> {
  readonly handles?: (item: HTMLElement) => ReadonlyMap<Element, Handle>;
  readonly columns?: number;
  readonly rowHeight?: number;
  readonly gap?: number;
  readonly sizing?: "fixed" | "content";
  readonly tile?: (item: HTMLElement, index: number) => Partial<Tile>;
  readonly onLayout?: (layout: Layout<HTMLElement>) => void;
}

interface Pitch {
  readonly x: number;
  readonly y: number;
  readonly gap: number;
}

const pixels = (tile: Tile, pitch: Pitch) => ({
  left: tile.x * pitch.x,
  top: tile.y * pitch.y,
  width: tile.width * pitch.x - pitch.gap,
  height: tile.height * pitch.y - pitch.gap,
});

function patch(tile: Tile, pitch: Pitch): Patch {
  const { left, top, width, height } = pixels(tile, pitch);
  return { matrix: plane.translate(left, top), size: { width, height } };
}

function cell(state: State, tile: Tile, pitch: Pitch): Tile {
  const span = (start: number, length: number, step: number) => {
    const first = Math.round(start / step);
    const last = Math.round((start + length + pitch.gap) / step);
    return { first, count: Math.max(1, last - first) };
  };
  const [, , , , left, top] = state.matrix;
  const column = span(left, state.size.width, pitch.x);
  const row = span(top, state.size.height, pitch.y);
  return {
    ...tile,
    x: column.first,
    y: row.first,
    width: column.count,
    height: row.count,
  };
}

function mark(container: HTMLElement): HTMLElement {
  const element = container.ownerDocument.createElement("div");
  element.dataset["layer"] = "placeholder";
  Object.assign(element.style, {
    position: "absolute",
    left: "0",
    top: "0",
    pointerEvents: "none",
    background:
      "var(--placeholder, color-mix(in srgb, currentColor 15%, transparent))",
  });
  container.append(element);
  return element;
}

function cover(element: HTMLElement, tile: Tile, pitch: Pitch): void {
  const { left, top, width, height } = pixels(tile, pitch);
  Object.assign(element.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  });
}

const affects = (
  item: HTMLElement,
  { target, attributeName }: MutationRecord,
): boolean =>
  item.contains(target) && (target !== item || attributeName !== "style");

export class Tileable extends Capability<
  HTMLElement,
  TileableOptions,
  Binding
> {
  #layout: Layout<HTMLElement> = new Map();
  #placeholder: HTMLElement | undefined;

  constructor(container: HTMLElement, options: TileableOptions = {}) {
    super(container, options);
    this.refresh();
  }

  get items(): HTMLElement[] {
    return query(this.node, this.options.items);
  }

  get layout(): Layout<HTMLElement> {
    return this.#layout;
  }

  move(item: HTMLElement, tile: Partial<Tile>): this {
    const current = this.#layout.get(item);
    if (this.active || !current) return this;
    const next = place(
      this.#layout,
      item,
      { ...current, ...tile },
      this.#tiling(),
    );
    if (next) this.#commit(this.#fit(next, [item], this.#pitch()));
    return this;
  }

  protected build(): readonly Part<Binding>[] {
    const { node } = this;
    const height = node.style.height;
    const width = node.clientWidth;
    const items = this.items;
    const layout = settle(this.#collect(), this.#tiling());
    this.#commit(this.#fit(layout, items, this.#pitch()));
    const pitch = this.#pitch();
    const observer = new ResizeObserver(() => {
      if (node.clientWidth !== width) this.refresh();
    });
    observer.observe(node);
    return [
      ...items.flatMap((item) => this.#bind(item, pitch)),
      ...this.#watch(),
      () => observer.disconnect(),
      () => {
        node.style.height = height;
      },
    ];
  }

  #watch(): (() => void)[] {
    if (this.options.sizing !== "content") return [];
    const { node } = this;
    const refit = (changed: (item: HTMLElement) => boolean) => {
      if (this.active) return;
      const items = this.items.filter(changed);
      const layout = this.#fit(this.#layout, items, this.#pitch());
      if (layout !== this.#layout) this.#commit(layout);
    };
    const observer = new MutationObserver((records) =>
      refit((item) => records.some((record) => affects(item, record))),
    );
    const load = ({ target }: Event) =>
      refit((item) => target instanceof Node && item.contains(target));
    observer.observe(node, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    node.addEventListener("load", load, true);
    return [
      () => observer.disconnect(),
      () => node.removeEventListener("load", load, true),
    ];
  }

  #fit(
    layout: Layout<HTMLElement>,
    items: readonly HTMLElement[],
    pitch: Pitch,
  ): Layout<HTMLElement> {
    if (this.options.sizing !== "content") return layout;
    const next = new Map(layout);
    for (const item of items) {
      const tile = layout.get(item);
      if (!tile || tile.fixed) continue;
      const length = intrinsic(item, tile.width * pitch.x - pitch.gap);
      const rows = Math.ceil((length + pitch.gap) / pitch.y - epsilon);
      next.set(item, { ...tile, height: Math.max(1, rows) });
    }
    if (same(next, layout)) return layout;
    const tiling = this.#tiling();
    const result = settle(next, tiling);
    const within = tiling.rows === undefined || bottom(result) <= tiling.rows;
    return within ? result : layout;
  }

  #tiling(): Tiling {
    const {
      columns = 12,
      rows,
      compact = "vertical",
      collision = "push",
    } = this.options;
    return {
      columns,
      compact,
      collision,
      ...(rows === undefined ? {} : { rows }),
    };
  }

  #pitch(): Pitch {
    const { columns = 12, rowHeight = 80, gap = 10 } = this.options;
    const column = (this.node.clientWidth - gap * (columns - 1)) / columns;
    return { x: column + gap, y: rowHeight + gap, gap };
  }

  #collect(): Layout<HTMLElement> {
    const { columns } = this.#tiling();
    const layout = new Map<HTMLElement, Tile>();
    this.items.forEach((item, index) => {
      const known = this.#layout.get(item);
      if (known) {
        layout.set(item, known);
        return;
      }
      const {
        x,
        y,
        width = 1,
        height = 1,
        fixed = false,
      } = this.options.tile?.(item, index) ?? {};
      const spot =
        x === undefined || y === undefined
          ? vacant(layout, width, height, columns)
          : { x, y, width, height };
      layout.set(item, { ...spot, fixed });
    });
    return layout;
  }

  #bind(item: HTMLElement, pitch: Pitch): Part<Binding>[] {
    if (this.#layout.get(item)?.fixed) return [];
    const { options } = this;
    const handles =
      options.handles?.(item) ??
      grips(item, [{ x: 1, y: options.sizing === "content" ? 0 : 1 }]);
    const plugins = options.plugins ?? [];
    const track = this.#track(item, pitch);
    const size = limits({
      width: { min: pitch.x - pitch.gap, max: this.node.clientWidth },
      height: { min: pitch.y - pitch.gap },
    });
    const drag = bind(item, {
      activation: deliberate,
      ...options,
      action: transform({ translate: true }),
      plugins: [...plugins, lift(item), track],
      keys: arrows(pitch.x, pitch.y),
    });
    const resizers = [...handles].map(([handle, side]) =>
      bind(item, {
        activation: deliberate,
        ...options,
        handle,
        ignore: [],
        action: resize({ handle: side }),
        plugins: [...plugins, size, lift(item), track],
      }),
    );
    const created = options.handles
      ? []
      : [
          () => {
            for (const grip of handles.keys()) grip.remove();
          },
        ];
    return [drag, ...resizers, ...created];
  }

  #track(item: HTMLElement, pitch: Pitch): Plugin {
    let origin = this.#layout;
    let preview = origin;
    let target: Tile | undefined;
    const finish = (layout: Layout<HTMLElement>) => {
      this.#placeholder?.remove();
      this.#placeholder = undefined;
      this.#commit(layout);
    };
    return {
      onStart: () => {
        origin = this.#layout;
        preview = origin;
        target = origin.get(item);
        this.#placeholder = mark(this.node);
        if (target) cover(this.#placeholder, target, pitch);
      },
      onMove: ({ state, input }) => {
        const current = preview.get(item);
        if (!current) return undefined;
        const next = cell(state, current, pitch);
        if (!equal(next, target)) {
          target = next;
          const placed = place(preview, item, next, this.#tiling());
          const layout = placed && this.#fit(placed, [item], pitch);
          if (layout && !same(layout, preview)) {
            preview = layout;
            this.#show(layout, item);
          }
        }
        const tile = preview.get(item);
        const keyboard = input.points.length === 0;
        return keyboard && tile ? merge(state, patch(tile, pitch)) : undefined;
      },
      onEnd: () => finish(preview),
      onCancel: () => finish(origin),
    };
  }

  #show(layout: Layout<HTMLElement>, active: HTMLElement): void {
    const pitch = this.#pitch();
    this.#render(layout, pitch, active);
    const tile = layout.get(active);
    if (this.#placeholder && tile) cover(this.#placeholder, tile, pitch);
  }

  #commit(layout: Layout<HTMLElement>): void {
    const previous = this.#layout;
    this.#render(layout, this.#pitch());
    this.#layout = layout;
    const initial = previous.size === 0;
    if (!initial && !same(layout, previous)) this.options.onLayout?.(layout);
  }

  #render(
    layout: Layout<HTMLElement>,
    pitch: Pitch,
    active?: HTMLElement,
  ): void {
    const items = [...layout.keys()].filter((item) => item !== active);
    const rects = record(items.filter((item) => this.#layout.has(item)));
    for (const item of items) {
      const tile = layout.get(item);
      if (tile) View.of(item).store.assign(patch(tile, pitch));
    }
    play(rects, this.options.duration);
    const rows = bottom(layout);
    this.node.style.height = `${Math.max(0, rows * pitch.y - pitch.gap)}px`;
  }
}

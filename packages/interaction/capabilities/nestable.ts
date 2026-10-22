import { plane, type Matrix, type Point } from "@openconsole/matrix";

import { hotspot, rank, transform, type Plugin } from "../core";
import {
  bind,
  deliberate,
  guides,
  inward,
  layered,
  lift,
  play,
  probe,
  record,
  rect,
  reset,
  restore,
  type Binding,
} from "../dom";
import { Capability, type Bounds, type Guide, type Part } from "../model";
import type { ListOptions, Place, Sort } from "./sortable";

export interface NestableOptions extends ListOptions {
  readonly zones?: string;
  readonly sources?: string;
  readonly create?: (source: HTMLElement) => HTMLElement;
  readonly onSort?: (sort: Sort) => void;
}

const horizontal = (zone: HTMLElement): boolean => {
  const style = getComputedStyle(zone);
  return (
    style.display.includes("flex") && style.flexDirection.startsWith("row")
  );
};

function boundary(
  before: Bounds | undefined,
  after: Bounds | undefined,
  zone: Bounds,
  row: boolean,
): number {
  const start = (box: Bounds) => (row ? box.left : box.top);
  const end = (box: Bounds) => (row ? box.right : box.bottom);
  if (before && after) return (end(before) + start(after)) / 2;
  if (after) return start(after);
  if (before) return end(before);
  return (start(zone) + end(zone)) / 2;
}

function copy(source: HTMLElement): HTMLElement | undefined {
  const node = source.cloneNode(true);
  return node instanceof HTMLElement ? node : undefined;
}

export class Nestable extends Capability<
  HTMLElement,
  NestableOptions,
  Binding
> {
  constructor(root: HTMLElement, options: NestableOptions = {}) {
    super(root, options);
    this.refresh();
  }

  get zones(): HTMLElement[] {
    const { zones } = this.options;
    const nested = zones ? [...this.node.querySelectorAll(zones)] : [];
    return [this.node, ...nested].filter((zone) => zone instanceof HTMLElement);
  }

  items(zone: HTMLElement): HTMLElement[] {
    const selector = this.options.items ?? "*";
    return [...zone.children].flatMap((child) =>
      child instanceof HTMLElement && child.matches(selector) && !layered(child)
        ? [child]
        : [],
    );
  }

  move(item: HTMLElement, zone: HTMLElement, index: number): this {
    if (!this.active) this.#drop(item, { list: zone, index });
    return this;
  }

  protected build(): readonly Part<Binding>[] {
    const { sources } = this.options;
    const items = this.zones.flatMap((zone) => this.items(zone));
    const palette = sources
      ? [...this.node.ownerDocument.querySelectorAll(sources)]
      : [];
    return [
      ...items.map((item) => this.#bind(item, false)),
      ...palette.flatMap((source) =>
        source instanceof HTMLElement ? [this.#bind(source, true)] : [],
      ),
    ];
  }

  #bind(node: HTMLElement, source: boolean): Binding {
    const { plugins = [] } = this.options;
    return bind(node, {
      activation: deliberate,
      ...this.options,
      action: transform({ translate: true }),
      plugins: [...plugins, lift(node, this.node), this.#track(node, source)],
    });
  }

  #track(node: HTMLElement, source: boolean): Plugin {
    let find = probe([], node);
    let spot: Place | undefined;
    const show = guides(() => this.node, 2);
    const finish = () => {
      show([]);
      const target = spot;
      spot = undefined;
      return target;
    };
    return {
      onStart: () => {
        find = probe(this.zones, node);
      },
      onMove: (context) => {
        const point = hotspot(context);
        const zone = point && find(point);
        const map = inward(this.node);
        spot = point && zone && this.#locate(zone, point, node);
        show(spot && map ? this.#line(spot, node, map) : []);
        return undefined;
      },
      onEnd: () => {
        const target = finish();
        if (!target) restore(node, this.options.duration);
        else if (source) this.#create(node, target);
        else this.#drop(node, target);
      },
      onCancel: () => {
        finish();
        restore(node, this.options.duration);
      },
    };
  }

  #locate(zone: HTMLElement, point: Point<2>, node: HTMLElement): Place {
    const row = horizontal(zone);
    const middles = this.items(zone)
      .filter((item) => item !== node)
      .map((item) => {
        const box = rect(item);
        return row ? (box.left + box.right) / 2 : (box.top + box.bottom) / 2;
      });
    return { list: zone, index: rank(row ? point.x : point.y, middles) };
  }

  #line(
    { list, index }: Place,
    node: HTMLElement,
    map: Matrix<2, "affine">,
  ): Guide[] {
    const row = horizontal(list);
    const zone = rect(list);
    const boxes = this.items(list)
      .filter((item) => item !== node)
      .map(rect);
    const position = boundary(boxes[index - 1], boxes[index], zone, row);
    const ends: readonly Point<2>[] = row
      ? [
          { x: position, y: zone.top },
          { x: position, y: zone.bottom },
        ]
      : [
          { x: zone.left, y: position },
          { x: zone.right, y: position },
        ];
    const [from, to] = ends.map((point) => plane.apply(map, point));
    return from && to ? [{ kind: "align", from, to }] : [];
  }

  #drop(item: HTMLElement, { list, index }: Place): void {
    const origin = item.parentElement;
    if (!origin) return;
    const from = { list: origin, index: this.items(origin).indexOf(item) };
    const siblings = this.items(list).filter((other) => other !== item);
    const rects = record(new Set([...this.items(origin), ...siblings, item]));
    list.insertBefore(item, siblings[index] ?? null);
    reset(item);
    play(rects, this.options.duration);
    const to = { list, index: this.items(list).indexOf(item) };
    if (from.list === to.list && from.index === to.index) return;
    this.options.onSort?.({ item, from, to });
  }

  #create(source: HTMLElement, { list, index }: Place): void {
    const origin = source.parentElement;
    const start = source.getBoundingClientRect();
    reset(source);
    const item = (this.options.create ?? copy)(source);
    if (!origin || !item) return;
    const siblings = this.items(list);
    const rects = record(siblings);
    list.insertBefore(item, siblings[index] ?? null);
    play(new Map([...rects, [item, start]]), this.options.duration);
    const from = { list: origin, index: [...origin.children].indexOf(source) };
    this.options.onSort?.({ item, from, to: { list, index } });
    queueMicrotask(() => this.refresh());
  }
}

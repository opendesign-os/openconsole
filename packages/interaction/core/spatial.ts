import type { Bounds } from "../model";

export interface Index<T> {
  insert(item: T, bounds: Bounds): void;
  search(bounds: Bounds): Iterable<T>;
  clear(): void;
}

const overlaps = (left: Bounds, right: Bounds): boolean =>
  left.left <= right.right &&
  right.left <= left.right &&
  left.top <= right.bottom &&
  right.top <= left.bottom;

export class Linear<T> implements Index<T> {
  readonly #items = new Map<T, Bounds>();

  insert(item: T, bounds: Bounds): void {
    this.#items.set(item, bounds);
  }

  search(bounds: Bounds): T[] {
    return [...this.#items].flatMap(([item, box]) =>
      overlaps(box, bounds) ? [item] : [],
    );
  }

  clear(): void {
    this.#items.clear();
  }
}

export class Hash<T> implements Index<T> {
  readonly #size: number;
  readonly #items = new Map<T, Bounds>();
  readonly #cells = new Map<string, T[]>();

  constructor(size = 128) {
    this.#size = size;
  }

  insert(item: T, bounds: Bounds): void {
    this.#items.set(item, bounds);
    for (const key of this.#keys(bounds)) {
      const cell = this.#cells.get(key);
      if (cell) cell.push(item);
      else this.#cells.set(key, [item]);
    }
  }

  search(bounds: Bounds): Set<T> {
    const found = new Set<T>();
    for (const key of this.#keys(bounds)) {
      for (const item of this.#cells.get(key) ?? []) {
        const box = this.#items.get(item);
        if (box && overlaps(box, bounds)) found.add(item);
      }
    }
    return found;
  }

  clear(): void {
    this.#items.clear();
    this.#cells.clear();
  }

  *#keys({ left, top, right, bottom }: Bounds): Generator<string> {
    const cell = (value: number) => Math.floor(value / this.#size);
    for (let x = cell(left); x <= cell(right); x += 1) {
      for (let y = cell(top); y <= cell(bottom); y += 1) yield `${x},${y}`;
    }
  }
}

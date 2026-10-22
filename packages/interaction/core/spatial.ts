/**
 * @file 空间索引：按包围盒存取条目，在大量目标里快速找出与查询范围相交的候选。
 *
 * 放置判定在会话开始时把各区域的包围盒插入索引，每次移动只查询与拖拽范围相交的区域，
 * 再对这些候选做精确判定。
 */

import type { Bounds } from "../model";

/**
 * 空间索引的约定：插入条目及其包围盒，按范围查询，整体清空。
 *
 * 查询结果是可能相交的候选：可以多返回（调用方会再精确判定），但不能漏掉相交的条目。
 * 可以接入 R 树、四叉树等实现。
 *
 * @template T 条目类型。
 */
export interface Index<T> {
  /**
   * 插入条目。
   *
   * @param item 条目。
   * @param bounds 条目的包围盒。
   */
  insert(item: T, bounds: Bounds): void;
  /**
   * 查询包围盒与范围相交的条目，边界接触也算相交。
   *
   * @param bounds 查询范围。
   * @returns 相交的条目，顺序不限，每个条目只出现一次。
   */
  search(bounds: Bounds): Iterable<T>;
  /** 移除全部条目。 */
  clear(): void;
}

/** 两个包围盒相交，边界接触也算。 */
const overlaps = (left: Bounds, right: Bounds): boolean =>
  left.left <= right.right &&
  right.left <= left.right &&
  left.top <= right.bottom &&
  right.top <= left.bottom;

/**
 * 线性索引：逐个比较包围盒，查询为 O(n)。条目不多时最简单，也是放置判定的默认索引。
 *
 * @template T 条目类型。
 * @example
 * const index = new Linear<string>();
 * index.insert("a", { left: 0, top: 0, right: 10, bottom: 10 });
 * index.search({ left: 5, top: 5, right: 6, bottom: 6 }); // ["a"]
 */
export class Linear<T> implements Index<T> {
  /** 条目到包围盒。 */
  readonly #items = new Map<T, Bounds>();

  /**
   * 插入条目；同一条目再次插入时覆盖它的包围盒。
   *
   * @param item 条目。
   * @param bounds 条目的包围盒。
   */
  insert(item: T, bounds: Bounds): void {
    this.#items.set(item, bounds);
  }

  /**
   * 查询包围盒与范围相交的条目。
   *
   * @param bounds 查询范围。
   * @returns 相交的条目，按插入顺序。
   */
  search(bounds: Bounds): T[] {
    return [...this.#items].flatMap(([item, box]) =>
      overlaps(box, bounds) ? [item] : [],
    );
  }

  /** 移除全部条目。 */
  clear(): void {
    this.#items.clear();
  }
}

/**
 * 网格哈希索引：把平面划成边长为 `size` 的方格，条目登记到它覆盖的每个格子里，
 * 查询只看查询范围覆盖的格子。条目多、分布均匀时查询接近 O(1)。
 *
 * 格子边长宜与常见区域尺寸同量级：太小时大区域要登记很多格，太大时每格的条目过多。
 *
 * @template T 条目类型。
 * @example
 * Droppable.index = new Hash(128); // 放置区很多时换成网格哈希
 */
export class Hash<T> implements Index<T> {
  /** 格子边长，与包围盒同单位。 */
  readonly #size: number;
  /** 条目到包围盒，查询时用来精确比较。 */
  readonly #items = new Map<T, Bounds>();
  /** 格子键 `"x,y"` 到登记在该格的条目。 */
  readonly #cells = new Map<string, T[]>();

  /**
   * @param size 格子边长，与包围盒同单位；缺省为 128。
   */
  constructor(size = 128) {
    this.#size = size;
  }

  /**
   * 插入条目，登记到它覆盖的每个格子；同一条目不要重复插入，需要更新时先 `clear()` 再插入。
   *
   * @param item 条目。
   * @param bounds 条目的包围盒。
   */
  insert(item: T, bounds: Bounds): void {
    this.#items.set(item, bounds);
    for (const key of this.#keys(bounds)) {
      const cell = this.#cells.get(key);
      if (cell) cell.push(item);
      else this.#cells.set(key, [item]);
    }
  }

  /**
   * 查询包围盒与范围相交的条目；跨多个格子的条目只返回一次。
   *
   * @param bounds 查询范围。
   * @returns 相交的条目。
   */
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

  /** 移除全部条目。 */
  clear(): void {
    this.#items.clear();
    this.#cells.clear();
  }

  /** 列出包围盒覆盖的格子键。 */
  *#keys({ left, top, right, bottom }: Bounds): Generator<string> {
    const cell = (value: number) => Math.floor(value / this.#size);
    for (let x = cell(left); x <= cell(right); x += 1) {
      for (let y = cell(top); y <= cell(bottom); y += 1) yield `${x},${y}`;
    }
  }
}

/**
 * @file 嵌套编辑能力（对标 Puck）：区域里的组件可以排序、跨区域移动、放进组件内的子区域，也可以从面板拖入新组件。
 *
 * 拖动期间不改 DOM，只在根节点里画插入线；松手才把组件插到目标位置，随后组件回到文档流，
 * 其他组件以 FLIP 过渡让位。区域、组件与面板条目都按选择器查找。
 */

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
  type BindOptions,
} from "../dom";
import { Capability, type Bounds, type Guide, type Part } from "../model";
import type { ListOptions, Place, Sort } from "./sortable";

/**
 * {@link Nestable} 的选项；另含 {@link ListOptions}，其中 `items` 与区域的直接子元素匹配，缺省为全部子元素。
 */
export interface NestableOptions extends ListOptions {
  /** 嵌套区域的选择器，在根节点内任意层级查找；根节点本身总是区域。 */
  readonly zones?: string;
  /** 面板条目的选择器，在整个文档里查找；拖进区域时调用 `create` 生成新组件，条目本身回到原处。 */
  readonly sources?: string;
  /** 由面板条目生成新组件；缺省深拷贝条目。 */
  readonly create?: (source: HTMLElement) => HTMLElement;
  /** 组件位置改变时调用；新建组件的 `from` 是它在面板里的位置。 */
  readonly onSort?: (sort: Sort) => void;
}

/** 区域是否横向排列（`flex` 且方向为 `row`）：横向时插入线竖着画，按 x 求位次。 */
const horizontal = (zone: HTMLElement): boolean => {
  const style = getComputedStyle(zone);
  return (
    style.display.includes("flex") && style.flexDirection.startsWith("row")
  );
};

/**
 * 插入线在排列方向上的位置（屏幕坐标）：前后都有组件时取两者间隙的中点，只有一侧时贴着它，
 * 区域为空时取区域中线。
 *
 * @param before 插入位置前面的组件盒。
 * @param after 插入位置后面的组件盒。
 * @param zone 区域盒。
 * @param row 区域是否横向排列。
 * @returns 横向时为 x，纵向时为 y。
 */
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

/** 默认的 `create`：深拷贝面板条目。 */
function copy(source: HTMLElement): HTMLElement | undefined {
  const node = source.cloneNode(true);
  return node instanceof HTMLElement ? node : undefined;
}

/**
 * 嵌套编辑：页面由嵌套区域组成，组件在区域内排序、跨区域移动，也可以从面板拖入新组件。
 *
 * 每个组件与面板条目一份平移绑定，插件为用户插件 → lift → track；`lift` 把组件连同已定位的祖先
 * 一起抬高，不会被其他区域盖住。按下点落在哪一层的组件就拖哪一层。
 * `update` 只在 `zones`、`items`、`sources` 变化时重建。
 *
 * @example
 * new Nestable(page, {
 *   zones: ".zone",
 *   items: ".block",
 *   sources: ".source",
 *   create: (source) => block(source.dataset.type),
 *   onSort: ({ item, from, to }) => render(),
 * });
 */
export class Nestable extends Capability<
  HTMLElement,
  NestableOptions,
  Binding
> {
  /**
   * @param root 根节点，本身也是一个区域。
   * @param options 嵌套编辑选项。
   */
  constructor(root: HTMLElement, options: NestableOptions = {}) {
    super(root, options);
    this.refresh();
  }

  /** 当前全部区域：根节点在前，其后是匹配 `zones` 的后代。 */
  get zones(): HTMLElement[] {
    const { zones } = this.options;
    const nested = zones ? [...this.node.querySelectorAll(zones)] : [];
    return [this.node, ...nested].filter((zone) => zone instanceof HTMLElement);
  }

  /**
   * 区域里的组件：匹配 `items` 的直接子元素，覆盖层（`data-layer`）除外。
   *
   * @param zone 区域节点。
   * @returns 组件，按 DOM 顺序。
   */
  items(zone: HTMLElement): HTMLElement[] {
    const selector = this.options.items ?? "*";
    return [...zone.children].flatMap((child) =>
      child instanceof HTMLElement && child.matches(selector) && !layered(child)
        ? [child]
        : [],
    );
  }

  /**
   * 不拖拽地把组件移到某个区域的指定位置；会话进行中不生效。
   *
   * @param item 要移动的组件。
   * @param zone 目标区域。
   * @param index 在目标区域组件中的序号，不计被移动的组件本身。
   * @returns 能力本身，便于链式调用。
   */
  move(item: HTMLElement, zone: HTMLElement, index: number): this {
    if (!this.active) this.#drop(item, { list: zone, index });
    return this;
  }

  /** 为所有区域里的组件与面板条目创建绑定。 */
  protected build(): readonly Part<Binding>[] {
    const { sources } = this.options;
    const items = this.zones.flatMap((zone) => this.items(zone));
    const palette = sources
      ? [...this.node.ownerDocument.querySelectorAll(sources)]
      : [];
    return [...items, ...palette].flatMap((node) =>
      node instanceof HTMLElement ? [bind(node, this.#config(node))] : [],
    );
  }

  /**
   * 就地更新各绑定；`zones`、`items`、`sources` 变化会改变被绑定的元素集合，需要重建。
   *
   * @param changes 本次传入 `update()` 的选项。
   * @returns 是否已就地应用。
   */
  protected apply(changes: Partial<NestableOptions>): boolean {
    if ("zones" in changes || "items" in changes || "sources" in changes) {
      return false;
    }
    for (const binding of this.units) {
      binding.update(this.#config(binding.node));
    }
    return true;
  }

  /** 组件或面板条目的绑定选项；`activation` 缺省为 {@link deliberate}，可被选项覆盖。 */
  #config(node: HTMLElement): BindOptions {
    const { plugins = [] } = this.options;
    return {
      activation: deliberate,
      ...this.options,
      action: transform({ translate: true }),
      plugins: [...plugins, lift(node, this.node), this.#track(node)],
    };
  }

  /** 节点是否是面板条目（匹配 `sources`）：松手时新建组件，而不是移动它本身。 */
  #source(node: HTMLElement): boolean {
    const { sources } = this.options;
    return sources !== undefined && node.matches(sources);
  }

  /**
   * 跟踪一次拖动：开始时量取全部区域（不含被拖组件自身的子区域），移动时由热点找出最内层区域与插入位次并画插入线；
   * 结束时插入或新建，没有目标或取消时以过渡回到原处。
   */
  #track(node: HTMLElement): Plugin {
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
        else if (this.#source(node)) this.#create(node, target);
        else this.#drop(node, target);
      },
      onCancel: () => {
        finish();
        restore(node, this.options.duration);
      },
    };
  }

  /**
   * 热点在区域里的插入位次：数出排列方向上中点位于热点之前的组件（不含被拖组件）。
   *
   * @param zone 命中的区域。
   * @param point 热点，屏幕坐标。
   * @param node 被拖节点。
   * @returns 目标区域与位次。
   */
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

  /**
   * 插入线：在屏幕坐标里求出横跨区域的线段，再经 `map` 换到根节点的内容空间，交给参考线绘制。
   *
   * @param place 目标区域与位次。
   * @param node 被拖节点，不参与计算。
   * @param map 屏幕坐标到根节点内容空间的映射（{@link inward}）。
   * @returns 一条对齐线；无法换算时为空。
   */
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

  /**
   * 把组件插到目标位置并回到文档流；原区域与目标区域的组件以 FLIP 过渡，位置变化时派发 `onSort`。
   */
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

  /**
   * 由面板条目新建组件：条目立即回到面板，新组件从条目松手处过渡到插入位置。
   *
   * 新组件的绑定在微任务里重建：此刻仍在条目自身会话的 `onEnd` 中，不能同步销毁它的绑定。
   */
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

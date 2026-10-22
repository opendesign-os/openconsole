/**
 * @file 嵌套编辑能力（对标 Puck）：区域里的组件可以排序、跨区域移动、放进组件内的子区域，也可以从面板拖入新组件。
 *
 * 拖动期间不改 DOM，只在根节点里画插入线；松手才把组件插到目标位置，随后组件回到文档流，
 * 其他组件以 FLIP 过渡让位。区域、组件与面板条目都按选择器查找。
 */

import { plane, type Point } from "@openconsole/matrix";

import {
  hotspot,
  locate,
  transform,
  type Flow,
  type Insertion,
  type Plugin,
} from "../core";
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
import { Capability, type Guide, type Part } from "../model";
import type { ListOptions, Place, Sort } from "./sortable";

/**
 * {@link Nestable} 的选项；另含 {@link ListOptions}，其中 `items` 与区域的直接子元素匹配，缺省为全部子元素。
 */
export interface NestableOptions extends ListOptions {
  /** 嵌套区域的选择器，在根节点内任意层级查找；根节点本身总是区域。 */
  readonly zones?: string;
  /**
   * 面板条目的选择器，在整个文档里查找；拖进区域时调用 `create` 生成新组件，条目本身立即回到原处。
   * 缺省没有面板。
   */
  readonly sources?: string;
  /** 由面板条目生成新组件；缺省深拷贝条目（`cloneNode(true)`）。新组件的绑定在下一个微任务里建立。 */
  readonly create?: (source: HTMLElement) => HTMLElement;
  /**
   * 组件位置改变时调用，拖拽与 `move()` 都会触发；放回原处或取消不调用。
   * 新建组件的 `from` 是面板条目在其父元素子节点中的位置。
   */
  readonly onSort?: (sort: Sort) => void;
}

/**
 * 轨道列表里的轨道数：去掉 `[name]` 形式的线名后按空白计数，`none` 记为 1。
 *
 * @param value 计算样式里的 `grid-template-columns` 或 `grid-template-rows`。
 * @returns 轨道数。
 */
const tracks = (value: string): number =>
  value === "none"
    ? 1
    : value
        .replace(/\[[^\]]*\]/g, " ")
        .trim()
        .split(/\s+/).length;

/**
 * 读取区域的排列方式，决定插入位次怎么数、插入线怎么画。
 *
 * - flex：按 `flex-direction` 定主轴与反向，`flex-wrap` 不为 `nowrap` 时可能换行；
 *   RTL 下的横向排列再反一次。
 * - grid：沿行自动放置时，多于一列就在行内从左往右、逐行往下数，只有一列就是纵向列表；
 *   沿列放置时同理。RTL 下的横向排列反向。
 * - 其他布局按纵向列表处理。
 *
 * @param zone 区域节点。
 * @returns 区域的排列方式。
 */
function flow(zone: HTMLElement): Flow {
  const style = getComputedStyle(zone);
  const rtl = style.direction === "rtl";
  if (style.display.includes("flex")) {
    const row = style.flexDirection.startsWith("row");
    return {
      row,
      reverse: style.flexDirection.endsWith("reverse") !== (row && rtl),
      wrap: style.flexWrap !== "nowrap",
    };
  }
  if (style.display.includes("grid")) {
    const column = style.gridAutoFlow.startsWith("column");
    const wrap =
      tracks(column ? style.gridTemplateRows : style.gridTemplateColumns) > 1;
    const row = column !== wrap;
    return { row, reverse: row && rtl, wrap };
  }
  return { row: false, reverse: false, wrap: false };
}

/**
 * 默认的 `create`：深拷贝面板条目。
 *
 * @param source 面板条目。
 * @returns 拷贝出的新组件；拷贝结果不是 HTML 元素时为 `undefined`。
 */
function copy(source: HTMLElement): HTMLElement | undefined {
  const node = source.cloneNode(true);
  return node instanceof HTMLElement ? node : undefined;
}

/**
 * 嵌套编辑：页面由嵌套区域组成，组件在区域内排序、跨区域移动，也可以从面板拖入新组件。
 *
 * 每个组件与面板条目一份平移绑定，插件为用户插件 → lift → track；`lift` 把组件连同已定位的祖先
 * 一起抬高，不会被其他区域盖住。按下点落在哪一层的组件就拖哪一层。
 *
 * 拖动时用热点（指针，键盘时为组件中心）找出最内层的区域（不含被拖组件自身的子区域），按区域的排列方式
 * （flex 的方向与换行、grid 的轨道、书写方向）求插入位次并画插入线；松手时插入或新建，没有目标或取消时
 * 组件带过渡回到原处。
 * `update` 只在 `zones`、`items`、`sources` 变化时重建；增删组件后调用 `refresh()`。
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
   * 把根节点变成嵌套编辑区：为所有区域里的组件与面板条目创建绑定。
   *
   * @param root 根节点，本身也是一个区域，插入线画在它里面。
   * @param options 嵌套编辑选项。
   */
  constructor(root: HTMLElement, options: NestableOptions = {}) {
    super(root, options);
    this.refresh();
  }

  /** 当前全部区域：根节点在前，其后是匹配 `zones` 的后代（文档顺序）；每次读取都重新查询。 */
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
   * 组件回到文档流，原区域与目标区域的组件以 FLIP 过渡，位置变化时派发 `onSort`。
   *
   * @param item 要移动的组件。
   * @param zone 目标区域。
   * @param index 在目标区域组件中的序号，不计被移动的组件本身；超出末尾时放到最后。
   * @returns 能力本身，便于链式调用。
   */
  move(item: HTMLElement, zone: HTMLElement, index: number): this {
    if (!this.active) this.#drop(item, { list: zone, index });
    return this;
  }

  /**
   * 为所有区域里的组件与面板条目创建绑定。
   *
   * @returns 每个组件与面板条目各一份绑定。
   */
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

  /**
   * 组件或面板条目的绑定选项；`activation` 缺省为 {@link deliberate}，可被选项覆盖。
   *
   * @param node 组件或面板条目。
   * @returns 绑定选项：动作为平移，插件为用户插件 → lift（上界为根节点）→ track。
   */
  #config(node: HTMLElement): BindOptions {
    const { plugins = [] } = this.options;
    return {
      activation: deliberate,
      ...this.options,
      action: transform({ translate: true }),
      plugins: [...plugins, lift(node, this.node), this.#track(node)],
    };
  }

  /**
   * 节点是否是面板条目（匹配 `sources`）：松手时新建组件，而不是移动它本身。
   *
   * @param node 被拖节点。
   * @returns 匹配 `sources` 时为 `true`；没有面板时总是 `false`。
   */
  #source(node: HTMLElement): boolean {
    const { sources } = this.options;
    return sources !== undefined && node.matches(sources);
  }

  /**
   * 跟踪一次拖动：开始时量取全部区域（不含被拖组件自身的子区域），移动时由热点找出最内层区域与插入位次并画插入线；
   * 结束时插入或新建，没有目标或取消时以过渡回到原处。
   *
   * @param node 被拖的组件或面板条目。
   * @returns 实现 `onStart`、`onMove`、`onEnd` 与 `onCancel` 的插件；`onMove` 从不修改候选。
   */
  #track(node: HTMLElement): Plugin {
    let find = probe([], node);
    let spot: Place | undefined;
    const show = guides(() => this.node, 2);
    /** 清除插入线并取出最后的目标位置。 */
    const finish = () => {
      show([]);
      const target = spot;
      spot = undefined;
      return target;
    };
    return {
      /** 按会话开始时的布局量取区域多边形。 */
      onStart: () => {
        find = probe(this.zones, node);
      },
      /** 由热点求目标区域与位次，画出（或清除）插入线；不修改候选，组件照常跟随指针。 */
      onMove: (context) => {
        const point = hotspot(context);
        const zone = point && find(point);
        const found = zone && point && this.#locate(zone, point, node);
        spot = zone && found && { list: zone, index: found.index };
        show(this.#line(found));
        return undefined;
      },
      /** 有目标时新建或插入组件，否则带过渡回到原处。 */
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
   * 热点在区域里的插入位置：组件按 DOM 顺序（不含被拖组件）交给 {@link locate}，
   * 排列方式取自区域的计算样式，所以反向、RTL、换行的 flex 与多列的 grid 都按屏幕上的顺序数。
   *
   * @param zone 命中的区域。
   * @param point 热点，屏幕坐标。
   * @param node 被拖节点。
   * @returns 插入位次与插入线（屏幕坐标）。
   */
  #locate(zone: HTMLElement, point: Point<2>, node: HTMLElement): Insertion {
    const boxes = this.items(zone)
      .filter((item) => item !== node)
      .map(rect);
    return locate(point, boxes, rect(zone), flow(zone));
  }

  /**
   * 插入线：把屏幕坐标里的线段经 {@link inward} 换到根节点的内容空间，交给参考线绘制。
   *
   * @param insertion 插入位置；没有目标时为 `undefined`。
   * @returns 一条对齐线；没有目标或无法换算时为空。
   */
  #line(insertion: Insertion | undefined): Guide[] {
    const map = inward(this.node);
    if (!insertion || !map) return [];
    const [from, to] = insertion.line;
    return [
      { kind: "align", from: plane.apply(map, from), to: plane.apply(map, to) },
    ];
  }

  /**
   * 把组件插到目标位置并回到文档流；原区域与目标区域的组件以 FLIP 过渡，位置变化时派发 `onSort`。
   *
   * 组件从松手处（或当前位置）过渡到新的布局位置；没有父元素的组件不处理。
   *
   * @param item 要放下的组件。
   * @param place 目标区域与位次，位次不计组件本身。
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
   *
   * @param source 被拖的面板条目。
   * @param place 目标区域与位次。
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

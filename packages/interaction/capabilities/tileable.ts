/**
 * @file 磁贴布局能力（对标 react-grid-layout 与 gridstack）：拖动或调整尺寸时按网格对齐，碰到的磁贴被推开，空隙按方向紧凑。
 *
 * 布局计算在 core 的 `place`、`settle` 里完成，不碰 DOM；这里负责把格子换算成像素、经各磁贴的
 * `View` 渲染、显示占位框，以及 `sizing: "content"` 时按内容量出行数。
 * 磁贴须绝对定位在容器左上（`position: absolute; left: 0; top: 0`），容器高度随布局自动调整。
 */

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
  type BindOptions,
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

/**
 * {@link Tileable} 的选项；另含 {@link ListOptions}，以及 {@link Tiling} 的 `rows`（行数上限，超出的移动被拒绝）、
 * `compact`（紧凑方向，缺省 `"vertical"`）与 `collision`（碰撞策略，缺省 `"push"`）。
 */
export interface TileableOptions extends ListOptions, Omit<Tiling, "columns"> {
  /** 每个磁贴的调整尺寸手柄；缺省自动生成一个，`sizing` 为 `"fixed"` 时在右下角，为 `"content"` 时在右边缘。 */
  readonly handles?: (item: HTMLElement) => ReadonlyMap<Element, Handle>;
  /**
   * 列数。
   * @default 12
   */
  readonly columns?: number;
  /**
   * 行高（像素）。
   * @default 80
   */
  readonly rowHeight?: number;
  /**
   * 磁贴之间的间距（像素）。
   * @default 10
   */
  readonly gap?: number;
  /**
   * 内容比磁贴高时怎么办：`"fixed"` 尺寸只由网格决定，内容在磁贴里滚动；
   * `"content"` 高度随内容自适应，`tile` 与 `move` 给的高度不再生效。
   * @default "fixed"
   */
  readonly sizing?: "fixed" | "content";
  /** 新磁贴的初始格子：可给 `x`、`y`、`width`、`height`、`fixed`；缺 `x`、`y` 时放到第一个空位，宽高缺省 1。 */
  readonly tile?: (item: HTMLElement, index: number) => Partial<Tile>;
  /** 布局提交后、确有变化时调用；初始布局不触发，读 `layout`。 */
  readonly onLayout?: (layout: Layout<HTMLElement>) => void;
}

/** 网格节距：相邻两列（行）起点之间的像素距离，即格宽（行高）加间距。 */
interface Pitch {
  /** 列节距。 */
  readonly x: number;
  /** 行节距。 */
  readonly y: number;
  /** 间距，磁贴实际宽高要减去它。 */
  readonly gap: number;
}

/** 把格子换算成容器空间的像素位置与尺寸。 */
const pixels = (tile: Tile, pitch: Pitch) => ({
  left: tile.x * pitch.x,
  top: tile.y * pitch.y,
  width: tile.width * pitch.x - pitch.gap,
  height: tile.height * pitch.y - pitch.gap,
});

/** 磁贴在格子里时的状态补丁：平移到格子左上，尺寸为格子像素尺寸。 */
function patch(tile: Tile, pitch: Pitch): Patch {
  const { left, top, width, height } = pixels(tile, pitch);
  return { matrix: plane.translate(left, top), size: { width, height } };
}

/**
 * 把跟随指针的状态吸附到最近的格子：起止边分别取整到节距（终边补上间距），至少占一格。
 *
 * @param state 当前候选状态，容器空间。
 * @param tile 当前格子，保留 `fixed` 等其余字段。
 * @param pitch 网格节距。
 * @returns 吸附后的格子。
 */
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

/** 创建占位框：标出被拖磁贴将落入的格子，带 `data-layer`，颜色取 CSS 变量 `--placeholder`。 */
function placeholder(container: HTMLElement): HTMLElement {
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

/** 把占位框摆到格子上。 */
function cover(element: HTMLElement, tile: Tile, pitch: Pitch): void {
  const { left, top, width, height } = pixels(tile, pitch);
  Object.assign(element.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  });
}

/** 改变网格结构或手柄的选项：变化时 `update` 重建，其余选项就地生效。 */
const structure: ReadonlySet<string> = new Set([
  "items",
  "handles",
  "sizing",
  "columns",
  "rowHeight",
  "gap",
  "rows",
  "compact",
  "collision",
]);

/** 手柄绑定的排除区：引用不变，就地更新时不会被当作变化而重新挂载。 */
const none: readonly Element[] = [];

/**
 * 变动是否影响磁贴的内容：磁贴内部的任何变动都算，磁贴自身的 `style` 除外，
 * 那是渲染与测量写入的，不代表内容变化。
 */
const affects = (
  item: HTMLElement,
  { target, attributeName }: MutationRecord,
): boolean =>
  item.contains(target) && (target !== item || attributeName !== "style");

/**
 * 磁贴布局：每个磁贴一份平移绑定与若干调整尺寸绑定，拖动时实时预览推开与紧凑的结果，松手提交。
 *
 * 拖动时磁贴跟随指针，占位框标出目标格子，其余磁贴以 FLIP 过渡到预览位置；松手后磁贴吸附到格子。
 * 方向键按格移动。固定磁贴（`fixed`）不绑定，也不会被推开。容器宽度变化时按新的节距重建。
 *
 * @example
 * const tiles = new Tileable(grid, {
 *   columns: 12,
 *   tile: (item, index) => ({ width: 4, height: 2 }),
 *   onLayout: (layout) => save(layout),
 * });
 * tiles.move(item, { x: 0, y: 0 }); // 程序化移动或改尺寸
 */
export class Tileable extends Capability<
  HTMLElement,
  TileableOptions,
  Binding
> {
  /** 每个绑定的选项工厂，就地更新时重新求值；重建时清空。 */
  readonly #configs = new Map<Binding, () => BindOptions>();
  /** 当前已提交的布局。 */
  #layout: Layout<HTMLElement> = new Map();
  /** 会话进行中的占位框。 */
  #placeholder: HTMLElement | undefined;

  /**
   * @param container 网格容器，磁贴默认是它的直接子元素。
   * @param options 磁贴布局选项。
   */
  constructor(container: HTMLElement, options: TileableOptions = {}) {
    super(container, options);
    this.refresh();
  }

  /** 当前磁贴，按 DOM 顺序；覆盖层不计入。 */
  get items(): HTMLElement[] {
    return query(this.node, this.options.items);
  }

  /** 当前布局：磁贴到格子。 */
  get layout(): Layout<HTMLElement> {
    return this.#layout;
  }

  /**
   * 程序化移动磁贴或改尺寸：按碰撞策略推开并紧凑后提交；会话进行中或被拒绝时不变。
   *
   * @param item 磁贴。
   * @param tile 要改的格子字段。
   * @returns 能力本身，便于链式调用。
   */
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

  /**
   * 收集并整理布局后提交，再为每个磁贴创建绑定。
   *
   * 已有磁贴保留原格子，新磁贴取 `tile` 给的初始格子；容器宽度变化时整体重建，
   * 销毁时恢复容器原来的内联高度。
   */
  protected build(): readonly Part<Binding>[] {
    const { node } = this;
    this.#configs.clear();
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

  /**
   * 结构性选项（见 `structure`）变化时重建，其余选项按各绑定的选项工厂重新求值、就地更新。
   *
   * @param changes 本次传入 `update()` 的选项。
   * @returns 是否已就地应用。
   */
  protected apply(changes: Partial<TileableOptions>): boolean {
    if (Object.keys(changes).some((key) => structure.has(key))) return false;
    for (const [binding, config] of this.#configs) binding.update(config());
    return true;
  }

  /**
   * `sizing: "content"` 时监听内容变化：增删节点、文字、属性的变动与图片等资源加载（捕获 `load`）
   * 都会让相关磁贴重新量高。本网格的会话进行中不量，松手后统一提交。
   *
   * @returns 停止监听的清理函数；固定尺寸时为空。
   */
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

  /**
   * `sizing: "content"` 时把磁贴高度换成放下内容所需的最少行数，再整体紧凑。
   *
   * 自然高度 `h` 由 `intrinsic` 在磁贴宽度下量出，行数为 `⌈(h + gap) / (rowHeight + gap)⌉`；
   * 固定磁贴保持声明的尺寸，超出 `rows` 时放弃本次调整。
   *
   * @param layout 待调整的布局。
   * @param items 需要重新量高的磁贴。
   * @param pitch 网格节距。
   * @returns 调整后的布局；没有变化或放不下时原样返回同一个对象。
   */
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

  /** 由选项得到布局引擎的参数，补上缺省值。 */
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

  /** 由容器当前宽度求节距：列宽为（容器宽度 − 间距总和）÷ 列数。 */
  #pitch(): Pitch {
    const { columns = 12, rowHeight = 80, gap = 10 } = this.options;
    const column = (this.node.clientWidth - gap * (columns - 1)) / columns;
    return { x: column + gap, y: rowHeight + gap, gap };
  }

  /** 收集当前磁贴的格子：已在布局里的沿用，新磁贴取 `tile` 给的格子，缺位置时放到第一个空位。 */
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

  /**
   * 为一个磁贴创建平移绑定与每个手柄的调整尺寸绑定；固定磁贴不绑定。
   *
   * 选项以工厂登记进 `#configs`，就地更新时重新求值；按键为按格移动的方向键，
   * 尺寸下限一格、上限为容器宽度。自动生成的手柄在重建或销毁时移除。
   */
  #bind(item: HTMLElement, pitch: Pitch): Part<Binding>[] {
    if (this.#layout.get(item)?.fixed) return [];
    const { options } = this;
    const handles =
      options.handles?.(item) ??
      grips(item, [{ x: 1, y: options.sizing === "content" ? 0 : 1 }]);
    const keys = arrows(pitch.x, pitch.y);
    const size = limits({
      width: { min: pitch.x - pitch.gap, max: this.node.clientWidth },
      height: { min: pitch.y - pitch.gap },
    });
    const link = (config: () => BindOptions): Binding => {
      const binding = bind(item, config());
      this.#configs.set(binding, config);
      return binding;
    };
    const plugins = () => this.options.plugins ?? [];
    const drag = link(() => ({
      activation: deliberate,
      ...this.options,
      action: transform({ translate: true }),
      plugins: [...plugins(), lift(item), this.#track(item, pitch)],
      keys,
    }));
    const resizers = [...handles].map(([handle, side]) =>
      link(() => ({
        activation: deliberate,
        ...this.options,
        handle,
        ignore: none,
        action: resize({ handle: side }),
        plugins: [...plugins(), size, lift(item), this.#track(item, pitch)],
      })),
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

  /**
   * 跟踪一次拖动或调整尺寸：磁贴本身跟随指针，吸附到的格子变化时在预览布局里放置并推开，
   * 渲染其余磁贴与占位框；键盘输入时把状态直接吸到预览格子上。
   * 松手提交预览，取消提交起点布局。
   */
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
        this.#placeholder = placeholder(this.node);
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

  /** 渲染预览布局：被拖磁贴除外，它跟随指针；占位框摆到它的目标格子上。 */
  #show(layout: Layout<HTMLElement>, active: HTMLElement): void {
    const pitch = this.#pitch();
    this.#render(layout, pitch, active);
    const tile = layout.get(active);
    if (this.#placeholder && tile) cover(this.#placeholder, tile, pitch);
  }

  /** 提交布局：渲染全部磁贴并记下；布局确有变化且不是初始布局时派发 `onLayout`。 */
  #commit(layout: Layout<HTMLElement>): void {
    const previous = this.#layout;
    this.#render(layout, this.#pitch());
    this.#layout = layout;
    const initial = previous.size === 0;
    if (!initial && !same(layout, previous)) this.options.onLayout?.(layout);
  }

  /**
   * 把布局写进各磁贴的状态，已在布局里的磁贴以 FLIP 过渡到新位置，再按行数设置容器高度。
   *
   * @param layout 要渲染的布局。
   * @param pitch 网格节距。
   * @param active 跟随指针的磁贴，不写它的状态。
   */
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

/**
 * @file 排序能力：列表里的每个条目一份平移绑定，拖动时实时重排 DOM 并用 FLIP 过渡，松手回到新位置。
 *
 * 插件顺序为 slot → 用户插件 → lift → track：slot 由候选状态算出插入位置写进 `index`，
 * track 在 `index` 变化时重排；重排移动的是其他条目而不是被拖条目，避免它离开 DOM 丢失指针捕获。
 */

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

/** 条目在列表中的位置。 */
export interface Place {
  /** 所在的列表（或区域）节点。 */
  readonly list: HTMLElement;
  /** 在列表条目中的序号，从 0 开始。 */
  readonly index: number;
}

/** 一次排序提交：条目从哪里移到了哪里。 */
export interface Sort {
  /** 被移动的条目。 */
  readonly item: HTMLElement;
  /** 原位置。 */
  readonly from: Place;
  /** 新位置。 */
  readonly to: Place;
}

/**
 * `Sortable`、`Tileable`、`Nestable` 共用的选项：管理一组条目的能力。
 *
 * 结果是结构变化（顺序、布局），由各自的事件报告，所以不提供 `onCommit`；
 * 按键由能力自己给出，`handle`、`ignore` 只接受选择器，在每个条目内查找。
 */
export interface ListOptions
  extends
    Omit<BindOptions, "action" | "handle" | "ignore" | "keys" | "onCommit">,
    CapabilityOptions {
  /** 条目的选择器，在根节点内查找，覆盖层（`data-layer`）自动排除；缺省为直接子元素。 */
  readonly items?: string;
  /** 句柄的选择器，在每个条目内查找；缺省整个条目都是句柄。 */
  readonly handle?: string;
  /** 排除区的选择器，在每个条目内查找，从这里按下不开始。 */
  readonly ignore?: string;
  /**
   * FLIP 过渡时长（毫秒），0 为不过渡。
   * @default 150
   */
  readonly duration?: number;
}

/** {@link Sortable} 的选项。 */
export interface SortableOptions extends ListOptions {
  /**
   * 由候选状态的中心与各条目的布局盒（容器空间）求插入位置，返回 -1 表示不变。
   * @default closest
   */
  readonly slot?: Slot;
  /** 顺序真正改变时调用；取消或放回原处不调用。 */
  readonly onSort?: (sort: Sort) => void;
}

/**
 * 排序：拖动条目时实时重排，其余条目以 FLIP 过渡让位，松手后条目落到新位置。
 *
 * 默认鼠标移动 3px、触屏长按 250ms 后开始（{@link deliberate}）；聚焦条目后按 Space 抓取，
 * 方向键移到相邻条目的位置，Esc 取消并恢复原顺序。`update` 只在 `items` 变化时重建。
 *
 * @example
 * const list = new Sortable(ul, {
 *   handle: ".grip",
 *   onSort: ({ item, from, to }) => save(item.id, from.index, to.index),
 * });
 * list.move(item, 0); // 不拖拽也能排序
 */
export class Sortable extends Capability<
  HTMLElement,
  SortableOptions,
  Binding
> {
  /**
   * @param list 列表节点，条目默认是它的直接子元素。
   * @param options 排序选项。
   */
  constructor(list: HTMLElement, options: SortableOptions = {}) {
    super(list, options);
    this.refresh();
  }

  /** 当前条目，按 DOM 顺序；覆盖层不计入。 */
  get items(): HTMLElement[] {
    return query(this.node, this.options.items);
  }

  /**
   * 不拖拽地把条目移到指定位置，作为拖拽之外的无障碍替代；会话进行中不生效。
   *
   * @param item 要移动的条目。
   * @param index 目标序号。
   * @returns 能力本身，便于链式调用。
   */
  move(item: HTMLElement, index: number): this {
    const from = this.items.indexOf(item);
    if (this.active || !this.#reorder(item, index)) return this;
    this.#index();
    this.#announce(item, from);
    return this;
  }

  /** 为每个条目创建绑定，并写入初始序号。 */
  protected build(): readonly Part<Binding>[] {
    return this.items.map((item, index) =>
      bind(item, this.#config(item)).assign({ index }),
    );
  }

  /**
   * 就地更新各条目的绑定；`items` 变化会改变条目集合，需要重建。
   *
   * @param changes 本次传入 `update()` 的选项。
   * @returns 是否已就地应用。
   */
  protected apply(changes: Partial<SortableOptions>): boolean {
    if ("items" in changes) return false;
    for (const binding of this.units) {
      binding.update(this.#config(binding.node));
    }
    return true;
  }

  /** 单个条目的绑定选项；`activation` 可被选项覆盖，插件顺序见文件说明。 */
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

  /** 由候选状态的中心求插入位置，写进状态的 `index`；`slot` 每次都读当前选项。 */
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

  /**
   * 把状态里的 `index` 落实到 DOM：变化时重排，并让被拖条目按新布局位置重绘以保持视觉位置；
   * 结束时过渡回新位置并通知，取消时先恢复原顺序。
   */
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

  /** 键盘映射：方向键给出移到前一个或后一个条目中心的容器空间平移。 */
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

  /**
   * 把条目移到 `index`，其余条目以 FLIP 过渡让位。
   *
   * 按 {@link arrange} 的计划把其他条目挪到被拖条目前后，被拖条目本身始终留在 DOM 中，
   * 不会因被移除而丢失指针捕获。
   *
   * @returns 顺序是否改变。
   */
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

  /** 把当前 DOM 顺序写回各条目状态的 `index`。 */
  #index(): void {
    const items = this.items;
    for (const binding of this.units) {
      binding.assign({ index: items.indexOf(binding.node) });
    }
  }

  /** 位置确有变化时派发 `onSort`。 */
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

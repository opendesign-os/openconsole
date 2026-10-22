/**
 * @file 拖拽能力：{@link bind} 的平移预设，按选项组装网格、磁吸、范围、碰撞与嵌套插件。
 *
 * 插件顺序固定为 grid → magnet → 用户插件 → bounds → collide → lift → nest → gridlines：
 * 先吸附得到候选，再按范围推回，碰撞放在最后，结果既贴齐又不越界、不重叠；
 * lift、nest、gridlines 只负责抬高层级、松手移交与画网格线，不改写状态。
 */

import { transform } from "../core";
import {
  arrows,
  bind,
  gridlines,
  guides,
  lift,
  nest,
  outlines,
  region,
  View,
  type Binding,
  type BindOptions,
} from "../dom";
import { Shape, type CapabilityOptions, type Part } from "../model";
import { bounds, collide, grid, magnet } from "../plugins";

/** {@link Draggable} 的选项；另含 {@link BindOptions} 中除 `action` 外的通用选项。 */
export interface DraggableOptions
  extends Omit<BindOptions, "action">, CapabilityOptions {
  /** 限定范围的祖先元素，可以是任意祖先，区域按节点当前所在的容器空间换算；缺省不限范围。 */
  readonly container?: HTMLElement;
  /**
   * 网格步长（像素，容器空间）；大于 0 时平移吸附到步长，方向键也按步长移动。
   * @default 0
   */
  readonly grid?: number;
  /**
   * 同时给了 `container` 与 `grid` 时，是否在容器里铺一层网格线。
   * @default true
   */
  readonly gridlines?: boolean;
  /** 磁吸目标：`true` 取父元素与兄弟元素，字符串为 `container`（缺省为文档）里的选择器；缺省不磁吸。 */
  readonly magnet?: boolean | string;
  /** 碰撞目标，取法同 `magnet`；会话开始时已重叠的目标被忽略；缺省不做碰撞。 */
  readonly collide?: boolean | string;
  /** 可放入的容器选择器：松手时指针下最内层的匹配容器接收节点，屏幕上的位置不变；缺省不移交。 */
  readonly nest?: string;
}

/**
 * 拖拽：节点跟随指针平移，祖先带旋转、缩放或斜切时同样贴着指针。
 *
 * 动作为 `transform({ translate: true })`；键盘方向键按网格步长（无网格时 1px）移动，
 * Shift 为 10 倍。`update` 只重算绑定选项并就地应用，从不重建。
 *
 * @example
 * const drag = new Draggable(card, { container: board, grid: 20, magnet: true, collide: true });
 * drag.update({ grid: 10 }); // 就地生效，进行中的拖拽不受影响
 * drag.destroy();
 */
export class Draggable extends Shape<HTMLElement, DraggableOptions, Binding> {
  /**
   * @param node 被拖动的节点。
   * @param options 拖拽选项。
   */
  constructor(node: HTMLElement, options: DraggableOptions = {}) {
    super(node, View.of(node).store, options);
    this.refresh();
  }

  /** 创建唯一的绑定。 */
  protected build(): readonly Part<Binding>[] {
    return [bind(this.node, this.#config())];
  }

  /**
   * 选项变化时按当前选项重算插件与按键，交给绑定就地更新。
   * @returns 总是 `true`：拖拽没有需要重建的结构性选项。
   */
  protected apply(): boolean {
    for (const binding of this.units) binding.update(this.#config());
    return true;
  }

  /** 由当前选项算出绑定选项；插件顺序见文件说明，未启用的插件为 `undefined` 后被滤掉。 */
  #config(): BindOptions {
    const { node, options } = this;
    const { container, grid: step = 0, plugins = [] } = options;
    const scope = container ?? node.ownerDocument;
    const home = container ?? node.parentElement;
    return {
      ...options,
      action: transform({ translate: true }),
      plugins: [
        step > 0 ? grid(step) : undefined,
        options.magnet
          ? magnet(outlines(node, options.magnet, scope), {
              onSnap: guides(() => node.offsetParent),
            })
          : undefined,
        ...plugins,
        container && bounds(region(container, node)),
        options.collide
          ? collide(outlines(node, options.collide, scope))
          : undefined,
        lift(node, container),
        options.nest && home ? nest(node, home, options.nest) : undefined,
        container && step > 0 && options.gridlines !== false
          ? gridlines(container, step)
          : undefined,
      ].filter((plugin) => plugin !== undefined),
      keys: options.keys ?? arrows(step > 0 ? step : 1),
    };
  }
}

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

/**
 * {@link Draggable} 的选项。
 *
 * 另含 {@link BindOptions} 中除 `action` 外的通用选项（输入源、句柄、排除区、插件、起动条件、
 * 渲染、按键、载荷与回调）；`plugins` 插在内置吸附插件之后、范围与碰撞之前。
 */
export interface DraggableOptions
  extends Omit<BindOptions, "action">, CapabilityOptions {
  /**
   * 限定范围的祖先元素，可以是任意祖先：节点的包围盒不越出它的客户区，区域按节点当前所在的
   * 容器空间换算（{@link region}）。同时是 `magnet`、`collide` 选择器的查找范围、抬高层级的上界，
   * 以及 `nest` 的最外层容器。缺省不限范围。
   */
  readonly container?: HTMLElement;
  /**
   * 网格步长（像素，容器空间）；为有限正数时平移吸附到步长（局部原点落在网格点上），
   * 方向键也按步长移动；其他值（0、负数、`NaN`、`Infinity`）不吸附，方向键每次 1px。
   *
   * @default 0
   */
  readonly grid?: number;
  /**
   * 同时给了 `container` 与 `grid` 时，是否在容器里铺一层网格线；同一容器、同一步长的网格线共用一层。
   *
   * @default true
   */
  readonly gridlines?: boolean;
  /**
   * 磁吸目标：`true` 取父元素与兄弟元素，字符串为 `container`（缺省为文档）里任意层级的选择器；
   * 吸附时在节点的 offsetParent 里画参考线。缺省不磁吸。
   */
  readonly magnet?: boolean | string;
  /** 碰撞目标，取法同 `magnet`；会话开始时已与节点重叠的目标被忽略。缺省不做碰撞。 */
  readonly collide?: boolean | string;
  /**
   * 可放入的容器选择器，在 `container`（缺省为节点当前的父元素）里任意层级查找：
   * 拖动时高亮热点下最内层的匹配容器（加 `data-over`，描边取 CSS 变量 `--over`），
   * 松手时把节点移交过去，屏幕上的位置、旋转与尺寸不变。热点在 `container` 内但不在任何匹配容器里时
   * 以 `container` 本身为目标；目标就是当前父元素时不移交。缺省不移交。
   */
  readonly nest?: string;
}

/**
 * 拖拽：节点跟随指针平移，祖先带旋转、缩放或斜切时同样贴着指针。
 *
 * 动作为 `transform({ translate: true })`；键盘方向键按网格步长（无网格时 1px）移动，
 * Shift 为 10 倍。与 `Resizable`、`Rotatable` 共享节点的同一份状态，可以同时挂在一个节点上，
 * 同一时间只有一个会话。`update` 只重算绑定选项并就地应用，从不重建，进行中的会话不受影响。
 *
 * @example
 * const drag = new Draggable(card, { container: board, grid: 20, magnet: true, collide: true });
 * drag.update({ grid: 10 }); // 就地生效，进行中的拖拽不受影响
 * drag.destroy();
 */
export class Draggable extends Shape<HTMLElement, DraggableOptions, Binding> {
  /**
   * 在节点上创建拖拽：加入节点的共享状态（`View.of(node).store`），并按选项立即绑定。
   *
   * @param node 被拖动的节点。
   * @param options 拖拽选项。
   */
  constructor(node: HTMLElement, options: DraggableOptions = {}) {
    super(node, View.of(node).store, options);
    this.refresh();
  }

  /**
   * 创建唯一的绑定。
   *
   * @returns 只含一份绑定的单元列表。
   */
  protected build(): readonly Part<Binding>[] {
    return [bind(this.node, this.#config())];
  }

  /**
   * 选项变化时按当前选项重算插件与按键，交给绑定就地更新。
   *
   * @returns 总是 `true`：拖拽没有需要重建的结构性选项。
   */
  protected apply(): boolean {
    for (const binding of this.units) binding.update(this.#config());
    return true;
  }

  /**
   * 由当前选项算出绑定选项；插件顺序见文件说明，未启用的插件为 `undefined` 后被滤掉。
   *
   * 每次调用都新建插件实例；会话中更新时，绑定在会话结束后才换上新插件。
   * 范围、磁吸与碰撞目标都在会话开始时量取，因此反映的是那一刻的布局。
   *
   * @returns 完整的绑定选项：动作固定为平移，按键缺省为按网格步长移动的方向键。
   */
  #config(): BindOptions {
    const { node, options } = this;
    const { container, grid: step = 0, plugins = [] } = options;
    const snap = Number.isFinite(step) && step > 0;
    const scope = container ?? node.ownerDocument;
    const home = container ?? node.parentElement;
    return {
      ...options,
      action: transform({ translate: true }),
      plugins: [
        snap ? grid(step) : undefined,
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
        container && snap && options.gridlines !== false
          ? gridlines(container, step)
          : undefined,
      ].filter((plugin) => plugin !== undefined),
      keys: options.keys ?? arrows(snap ? step : 1),
    };
  }
}

/**
 * @file 平移缩放能力：拖动视口平移世界层，滚轮、双指或按键绕一点缩放。
 *
 * 命中的是视口，变换的是世界层；世界层里的元素照常挂 `Draggable`，按下点落在元素上时元素优先。
 * 默认输入源在指针、键盘之外再加滚轮。
 */

import { plane } from "@openconsole/matrix";

import { transform, type Step } from "../core";
import {
  arrows,
  bind,
  keyboard,
  pointer,
  View,
  wheel,
  type Binding,
  type BindOptions,
  type Sensor,
} from "../dom";
import { Shape, type CapabilityOptions, type Part, type Range } from "../model";
import { limits } from "../plugins";

/** {@link Zoomable} 的选项；另含 {@link BindOptions} 中除 `action`、`handle` 外的通用选项。 */
export interface ZoomableOptions
  extends Omit<BindOptions, "action" | "handle">, CapabilityOptions {
  /** 视口：接收指针与滚轮的元素，须是世界层的 `offsetParent`。 */
  readonly viewport: HTMLElement;
  /**
   * 双指时是否允许旋转。
   * @default false
   */
  readonly rotate?: boolean;
  /**
   * 缩放比例的范围，绕锚点夹住。
   * @default { min: 0.1, max: 8 }
   */
  readonly scale?: Range;
}

/** 默认输入源：指针、键盘与滚轮；模块级常量，引用不变，`update` 时不必重新挂载。 */
const sensors: readonly Sensor[] = [pointer(), keyboard(), wheel()];

/**
 * 平移缩放：视口上拖动平移，滚轮绕指针缩放，双指同时平移、缩放（与可选的旋转）。
 *
 * 动作为 `transform({ translate: true, scale: true, rotate })`，缩放只允许等比；
 * 方向键平移 20px，`+`、`=` 放大 1.25 倍，`-` 缩小到 0.8 倍，都以视口中心为锚点。
 * 换掉 `sensors` 可以去掉滚轮或调整滚轮速度，`update` 就地生效。
 *
 * @example
 * new Zoomable(world, { viewport, scale: { min: 0.25, max: 4 } });
 * new Zoomable(world, { viewport, sensors: [pointer(), keyboard(), wheel(0.003)] });
 */
export class Zoomable extends Shape<HTMLElement, ZoomableOptions, Binding> {
  /**
   * @param world 世界层：被平移缩放的元素。
   * @param options 平移缩放选项，必须给出 `viewport`。
   */
  constructor(world: HTMLElement, options: ZoomableOptions) {
    super(world, View.of(world).store, options);
    this.refresh();
  }

  /** 创建唯一的绑定，句柄为视口。 */
  protected build(): readonly Part<Binding>[] {
    return [bind(this.node, this.#config())];
  }

  /**
   * 按当前选项重算绑定选项并就地更新；换视口时绑定会重新挂载句柄。
   * @returns 总是 `true`：平移缩放没有需要重建的结构性选项。
   */
  protected apply(): boolean {
    for (const binding of this.units) binding.update(this.#config());
    return true;
  }

  /** 由当前选项算出绑定选项；缩放范围由 `limits` 插件最后夹住。 */
  #config(): BindOptions {
    const {
      viewport,
      rotate = false,
      scale = { min: 0.1, max: 8 },
      plugins = [],
      keys,
    } = this.options;
    const zoom = (factor: number) => (): Step => ({
      matrix: plane.around(
        { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 },
        plane.scale(factor),
      ),
      space: "container",
    });
    return {
      sensors,
      ...this.options,
      handle: viewport,
      action: transform({ translate: true, rotate, scale: true }),
      plugins: [...plugins, limits({ scale })],
      keys: keys ?? {
        ...arrows(20),
        "+": zoom(1.25),
        "=": zoom(1.25),
        "-": zoom(0.8),
      },
    };
  }
}

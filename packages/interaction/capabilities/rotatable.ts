/**
 * @file 旋转能力：{@link bind} 的旋转预设，绕支点转动节点，可按角度步长吸附。
 *
 * 不传 `handle` 时在节点上方自动生成旋转把手（`data-layer="grip"`）；
 * 键盘左右方向键按步长旋转，Shift 为 15 倍。
 */

import { plane, type Point } from "@openconsole/matrix";

import { transform, type Step } from "../core";
import {
  bind,
  knob,
  View,
  type Binding,
  type BindOptions,
  type Keys,
} from "../dom";
import { Shape, type CapabilityOptions, type Part, type State } from "../model";
import { angle } from "../plugins";

/** {@link Rotatable} 的选项；另含 {@link BindOptions} 中除 `action` 外的通用选项，`handle` 缺省为自动把手。 */
export interface RotatableOptions
  extends Omit<BindOptions, "action">, CapabilityOptions {
  /** 支点，局部空间（节点边框盒左上为原点）；缺省为边框盒中心。 */
  readonly pivot?: Point<2>;
  /** 角度吸附的步长（弧度），也是方向键每次旋转的角度；缺省不吸附，方向键每次 1°。 */
  readonly step?: number;
}

/**
 * 旋转的按键映射：左右方向键绕支点转 `unit`，Shift 时转 15 倍。
 *
 * @param pivot 支点，局部空间；缺省时每次按键取当前尺寸的中心。
 * @param unit 每次旋转的角度（弧度）。
 * @returns 方向键到局部空间 {@link Step} 的映射。
 */
function turns(pivot: Point<2> | undefined, unit: number): Keys {
  const turn =
    (factor: number) =>
    (state: State): Step => ({
      matrix: plane.around(
        pivot ?? { x: state.size.width / 2, y: state.size.height / 2 },
        plane.rotate(factor * unit),
      ),
      space: "local",
    });
  return {
    ArrowLeft: turn(-1),
    ArrowRight: turn(1),
    "Shift+ArrowLeft": turn(-15),
    "Shift+ArrowRight": turn(15),
  };
}

/**
 * 旋转：拖动把手绕支点旋转，祖先带变换时同样贴着指针。
 *
 * 动作为 `transform({ rotate: true, pivot })`，单指时以支点为虚拟第一点求出角度。
 * 与 `Draggable`、`Resizable` 共享同一份状态，可以同时挂在一个节点上。
 *
 * @example
 * new Rotatable(card, { step: Math.PI / 12 }); // 自动生成把手，吸附 15°
 * new Rotatable(dial, { handle: grip, pivot: { x: 0, y: 0 } });
 */
export class Rotatable extends Shape<HTMLElement, RotatableOptions, Binding> {
  /**
   * @param node 被旋转的节点。
   * @param options 旋转选项。
   */
  constructor(node: HTMLElement, options: RotatableOptions = {}) {
    super(node, View.of(node).store, options);
    this.refresh();
  }

  /** 创建绑定；未给 `handle` 时生成把手作为句柄，重建或销毁时移除。 */
  protected build(): readonly Part<Binding>[] {
    if (this.options.handle) return [bind(this.node, this.#config())];
    const grip = knob(this.node);
    return [
      bind(this.node, { ...this.#config(), handle: grip }),
      () => grip.remove(),
    ];
  }

  /**
   * 就地更新动作、插件与按键；`handle` 变化会在自动把手与自定义句柄之间切换，需要重建。
   *
   * @param changes 本次传入 `update()` 的选项。
   * @returns 是否已就地应用。
   */
  protected apply(changes: Partial<RotatableOptions>): boolean {
    if ("handle" in changes) return false;
    for (const binding of this.units) binding.update(this.#config());
    return true;
  }

  /** 由当前选项算出绑定选项：有步长时加 `angle` 吸附，排在用户插件之前。 */
  #config(): BindOptions {
    const { pivot, step, plugins = [], keys } = this.options;
    return {
      ...this.options,
      action: transform({ rotate: true, ...(pivot ? { pivot } : {}) }),
      plugins: [step ? angle(step) : undefined, ...plugins].filter(
        (plugin) => plugin !== undefined,
      ),
      keys: keys ?? turns(pivot, step ?? Math.PI / 180),
    };
  }
}

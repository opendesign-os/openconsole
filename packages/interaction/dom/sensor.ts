/**
 * @file 输入源约定：绑定与输入源之间的接口。
 *
 * 指针、键盘、滚轮以及自定义输入都实现 {@link Sensor}：绑定为每个句柄与排除区调用一次，
 * 输入源把原生事件换算成 {@link Input} 或 `Step`，再调用 {@link Control} 的方法驱动会话。
 */

import type { Point } from "@openconsole/matrix";

import type { Action, Input, Step } from "../core";
import type { State } from "../model";

/**
 * 指针会话的起动条件。
 *
 * 给出 `delay` 时为长按：按住 `delay` 毫秒且移动不超过 `tolerance` 才开始，超出即放弃这次按下；
 * 否则移动达到 `distance` 就开始。距离都是屏幕像素。
 */
export interface Activation {
  /**
   * 起动前需要移动的距离（屏幕像素）。
   * @default 0
   */
  readonly distance?: number;
  /** 长按时长（毫秒）；给出时改为长按起动。 */
  readonly delay?: number;
  /**
   * 长按期间允许的移动距离（屏幕像素），超出即放弃这次按下。
   * @default 0
   */
  readonly tolerance?: number;
}

/**
 * 键盘映射的值：直接给出的 `Step`，或按当前状态计算 `Step` 的函数。
 *
 * 函数返回 `undefined` 时这次按键不移动（例如排序已到列表两端）。
 */
export type Key = Step | ((state: State) => Step | undefined);

/**
 * 键盘映射：键名（`event.key`）或 `Shift+键名` → {@link Key}。
 *
 * 按住 Shift 时先查 `Shift+键名`，没有再回退到不带修饰的键名。
 */
export type Keys = Readonly<Record<string, Key>>;

/**
 * 输入源可以驱动的对象，即 `Binding`。
 *
 * 输入源只通过这组方法开始、推进与结束会话；`keys`、`activation` 是内置键盘与指针输入源读取的配置。
 */
export interface Control {
  /** 被变换的节点。 */
  readonly node: HTMLElement;
  /** 当前状态（容器空间）。 */
  readonly state: State;
  /** 当前动作；指针输入源据其自由度决定最多接受几根手指。 */
  readonly action: Action;
  /** 键盘映射；为空时键盘输入源不挂载。 */
  readonly keys: Keys;
  /**
   * 按指针类型取起动条件。
   * @param type `PointerEvent.pointerType`，如 `"mouse"`、`"touch"`、`"pen"`。
   * @returns 该指针类型的起动条件。
   */
  activation(type: string): Activation;
  /**
   * 开始会话。
   * @param input 起点输入，点为屏幕坐标。
   * @returns 是否开始；节点已有会话、被同一节点上的其他绑定锁住或无法测量时为 `false`。
   */
  start(input: Input): boolean;
  /**
   * 按输入点推进会话。
   * @param input 当前输入，点为屏幕坐标。
   */
  move(input: Input): void;
  /**
   * 以一步离散变换推进会话，用于键盘与滚轮。
   * @param step 一次直接给出的变换及其所在空间。
   */
  nudge(step: Step): void;
  /**
   * 结束会话；插件仍在动画时继续出帧，停下后才真正结束。
   * @param input 结束时的输入，可省略。
   */
  end(input?: Input): void;
  /** 取消会话，状态回到起点。 */
  cancel(): void;
}

/**
 * 一个句柄或排除区标记。
 *
 * 沿事件路径由内向外，同一绑定上最内层的标记生效，外层标记 `priority` 更高时覆盖内层；
 * 排除区只阻止起动，键盘、滚轮等输入源只挂在句柄上。
 */
export interface Mark {
  /** 被标记的元素。 */
  readonly element: Element;
  /** `"handle"` 允许从这里按下起动，`"ignore"` 禁止。 */
  readonly kind: "handle" | "ignore";
  /** 优先级，越大越优先；也决定同一元素上多个绑定的先后。 */
  readonly priority: number;
}

/**
 * 输入源：为一个标记挂载监听，把原生事件换算后调用 `control` 的方法。
 *
 * 绑定对每个句柄与排除区各调用一次；不关心该标记时返回 `undefined`，
 * 否则返回清理函数，在标记注销或输入源重挂时调用。
 *
 * @example
 * const remote: Sensor = (control, { element, kind }) => {
 *   if (kind !== "handle") return undefined;
 *   const listener = (event: Event) => {}; // 换算成 Input 后调用 control.start、move、end
 *   element.addEventListener("remote", listener);
 *   return () => element.removeEventListener("remote", listener);
 * };
 * bind(node, { action: transform({ translate: true }), sensors: [pointer(), remote] });
 */
export type Sensor = (control: Control, mark: Mark) => (() => void) | undefined;

/**
 * 把鼠标、指针或键盘事件换算成 {@link Input}。
 * @param event 原生事件，提供修饰键与时间戳。
 * @param points 屏幕坐标下的输入点；键盘输入为空。
 * @returns 带修饰键、原生事件与 `timeStamp` 的输入。
 */
export const input = (
  event: MouseEvent | KeyboardEvent,
  points: Iterable<Point<2>> = [],
): Input => ({
  points: [...points],
  modifiers: {
    shift: event.shiftKey,
    alt: event.altKey,
    control: event.ctrlKey,
    meta: event.metaKey,
  },
  event,
  timestamp: event.timeStamp,
});

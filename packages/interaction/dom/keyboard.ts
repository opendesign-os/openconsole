/**
 * @file 键盘输入源：Space/Enter 抓取与放下，按键映射成 `Step` 推进，Esc 取消。
 *
 * 每个 document 只装一个 `keydown`；全局同一时间只有一个键盘会话，被抓取的元素失焦时按放下处理。
 * 键盘输入没有输入点：放置判定的热点取节点中心，旋转、缩放的锚点取支点（缺省为节点中心）。
 */

import { plane } from "@openconsole/matrix";

import type { Input, Step } from "../core";
import { input, type Control, type Keys, type Sensor } from "./sensor";

/**
 * 生成方向键映射：方向键移动一步，Shift+方向键移动十步，步长在容器空间。
 *
 * 每一步都是 `"container"` 空间的平移，不随节点自身的旋转、缩放改变方向。
 *
 * @param x 水平步长（容器空间像素）。
 * @param y 垂直步长（容器空间像素），缺省同 `x`。
 * @returns 含 `ArrowLeft`、`ArrowRight`、`ArrowUp`、`ArrowDown` 及其 `Shift+` 组合的键盘映射。
 * @example
 * new Draggable(card, { keys: arrows(20) });
 * arrows(8, 4); // 水平每步 8px、垂直每步 4px；按住 Shift 时为 80px、40px
 */
export function arrows(x: number, y = x): Keys {
  /** 向右 `right` 步、向下 `down` 步的平移；负数为反方向。 */
  const move = (right: number, down: number): Step => ({
    matrix: plane.translate(right * x, down * y),
    space: "container",
  });
  return {
    ArrowLeft: move(-1, 0),
    ArrowRight: move(1, 0),
    ArrowUp: move(0, -1),
    ArrowDown: move(0, 1),
    "Shift+ArrowLeft": move(-10, 0),
    "Shift+ArrowRight": move(10, 0),
    "Shift+ArrowUp": move(0, -10),
    "Shift+ArrowDown": move(0, 10),
  };
}

/** 可抓取的元素 → 它的绑定；同一元素后登记的绑定覆盖先登记的。 */
const controls = new WeakMap<Element, Control>();
/** 当前键盘会话：被抓取的元素与它的绑定；没有会话时为 `undefined`。 */
let active:
  | {
      /** 被抓取的元素，即会话开始时聚焦的句柄；它失焦时按放下处理。 */
      readonly element: Element;
      /** 被抓取元素的绑定。 */
      readonly control: Control;
    }
  | undefined;

/**
 * 判断按键是否为抓取与放下用的键：Space 与 Enter。
 *
 * @param key `KeyboardEvent.key`。
 * @returns 是 Space（`" "`）或 Enter 时为 `true`。
 */
const grabs = (key: string): boolean => key === " " || key === "Enter";

/** 被抓取的元素失焦时按放下处理。 */
function blur(): void {
  stop("end", { points: [] });
}

/**
 * 结束当前键盘会话并摘除失焦监听；没有会话时什么也不做。
 *
 * @param kind `"end"` 放下，`"cancel"` 取消并回到起点。
 * @param last 结束时的输入，放下时交给 `control.end`。
 */
function stop(kind: "end" | "cancel", last: Input): void {
  const current = active;
  if (!current) return;
  active = undefined;
  current.element.removeEventListener("blur", blur);
  if (kind === "end") current.control.end(last);
  else current.control.cancel();
}

/**
 * 文档级 `keydown`：会话中处理放下、取消与移动键；未抓取时在可抓取的元素上按 Space/Enter 开始会话。
 *
 * - 会话中：Escape 取消，Space/Enter 放下；其他键按映射查出 `Key` 后 `nudge`，
 *   查不到的键不处理，函数值返回 `undefined` 时只阻止默认行为、不移动。
 * - 未抓取：只认事件目标本身（即聚焦的元素）登记的绑定，`start` 失败时不处理。
 *
 * 已被其他处理阻止默认行为的按键不处理；处理了的按键都会阻止默认行为（例如页面滚动）。
 *
 * @param event 键盘事件。
 */
function down(event: KeyboardEvent): void {
  if (event.defaultPrevented) return;
  if (active) {
    const { control } = active;
    if (event.key === "Escape" || grabs(event.key)) {
      event.preventDefault();
      stop(event.key === "Escape" ? "cancel" : "end", input(event));
      return;
    }
    const name = event.shiftKey ? `Shift+${event.key}` : event.key;
    const key = control.keys[name] ?? control.keys[event.key];
    if (!key) return;
    event.preventDefault();
    const step = typeof key === "function" ? key(control.state) : key;
    if (step) control.nudge(step);
    return;
  }
  if (!grabs(event.key) || !(event.target instanceof Element)) return;
  const element = event.target;
  const control = controls.get(element);
  if (!control?.start(input(event))) return;
  event.preventDefault();
  active = { element, control };
  element.addEventListener("blur", blur, { once: true });
}

/**
 * 让元素可被键盘抓取：登记绑定，确保文档装好 `keydown` 委托，元素不可聚焦时临时设 `tabindex="0"`。
 *
 * 重复添加同一个 `keydown` 监听会被浏览器忽略，所以每个 document 只有一个委托；委托不随清理摘除。
 *
 * @param element 句柄元素。
 * @param control 它的绑定。
 * @returns 清理函数：注销、移除临时的 `tabindex`，正在抓取时取消会话。
 */
function listen(element: Element, control: Control): () => void {
  controls.set(element, control);
  element.ownerDocument.addEventListener("keydown", down);
  const focus =
    element instanceof HTMLElement &&
    !element.hasAttribute("tabindex") &&
    element.tabIndex < 0;
  if (focus) element.tabIndex = 0;
  return () => {
    if (controls.get(element) === control) controls.delete(element);
    if (focus) element.removeAttribute("tabindex");
    if (active?.control === control) stop("cancel", { points: [] });
  };
}

/**
 * 键盘输入源：聚焦句柄后按 Space/Enter 抓取，按 `keys` 移动，再按一次放下，Esc 取消。
 *
 * 只挂在句柄上，且绑定的 `keys` 为空时不挂，避免无用的 Tab 停留点。
 *
 * @returns 输入源。
 * @example
 * bind(node, {
 *   action: transform({ translate: true }),
 *   keys: arrows(10),
 *   sensors: [pointer(), keyboard()],
 * });
 */
export const keyboard =
  (): Sensor =>
  (control, { element, kind }) =>
    kind === "handle" && Object.keys(control.keys).length > 0
      ? listen(element, control)
      : undefined;

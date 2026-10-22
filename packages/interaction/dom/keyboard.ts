/**
 * @file 键盘输入源：Space/Enter 抓取与放下，按键映射成 `Step` 推进，Esc 取消。
 *
 * 每个 document 只装一个 `keydown`；全局同一时间只有一个键盘会话，被抓取的元素失焦时按放下处理。
 */

import { plane } from "@openconsole/matrix";

import type { Input, Step } from "../core";
import { input, type Control, type Keys, type Sensor } from "./sensor";

/**
 * 生成方向键映射：方向键移动一步，Shift+方向键移动十步，步长在容器空间。
 * @param x 水平步长（容器空间像素）。
 * @param y 垂直步长，缺省同 `x`。
 * @returns 键盘映射。
 * @example
 * new Draggable(card, { keys: arrows(20) });
 */
export function arrows(x: number, y = x): Keys {
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

/** 可抓取的元素 → 它的绑定。 */
const controls = new WeakMap<Element, Control>();
/** 当前键盘会话：被抓取的元素与它的绑定。 */
let active:
  | { readonly element: Element; readonly control: Control }
  | undefined;

/** 抓取与放下用的按键：Space 与 Enter。 */
const grabs = (key: string): boolean => key === " " || key === "Enter";

/** 被抓取的元素失焦时按放下处理。 */
function blur(): void {
  stop("end", { points: [] });
}

/**
 * 结束当前键盘会话。
 * @param kind `"end"` 放下，`"cancel"` 取消并回到起点。
 * @param last 结束时的输入。
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
 * 已被其他处理阻止默认行为的按键不处理；处理了的按键都会阻止默认行为（例如页面滚动）。
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
  if (!control || !control.start(input(event))) return;
  event.preventDefault();
  active = { element, control };
  element.addEventListener("blur", blur, { once: true });
}

/**
 * 让元素可被键盘抓取：登记绑定，元素不可聚焦时临时设 `tabindex="0"`。
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

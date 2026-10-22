/**
 * @file 滚轮输入源：绕指针缩放，连续滚动合并为一次会话，停滚 150ms 后结束。
 *
 * 每次滚动换算成屏幕空间的缩放 `Step` 交给 `nudge`，所以缩放作用在约束之后的当前状态上，
 * 撞到缩放上下限后反向滚动立即生效。
 */

import { plane } from "@openconsole/matrix";

import type { Input } from "../core";
import { input, type Control, type Sensor } from "./sensor";

/** `WheelEvent.deltaMode` 换算成像素的系数，下标依次为像素（0）、行（1，按 16px）、页（2，按 800px）。 */
const units = [1, 16, 800];

/**
 * 在元素上监听滚轮：首次滚动开始会话，每次滚动以屏幕空间的缩放 `Step` 推进，150ms 无滚动即结束。
 *
 * 缩放倍数为 `exp(−delta·speed)`，`delta` 为换算成像素的 `deltaY`：向下滚缩小、向上滚放大，
 * 绕指针所在点（屏幕坐标）缩放。监听不是 passive，每次滚轮事件都阻止默认行为（页面滚动），
 * 即使会话无法开始也是如此：句柄独占滚轮，会话开不了通常是因为这个节点上已有会话（如正在拖动平移），
 * 此时放行页面滚动会让页面在拖动途中跳动。
 *
 * @param element 句柄元素。
 * @param control 它的绑定。
 * @param speed 每像素滚动量对应的对数缩放速率。
 * @returns 清理函数：摘除监听，进行中的会话随即结束。
 */
function attach(element: Element, control: Control, speed: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: Input = { points: [] };
  /** 停滚计时到点或清理时结束会话；没有会话在进行时什么也不做。 */
  const finish = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    control.end(last);
  };
  /** 处理一次滚动：必要时开始会话，推进一步缩放，再重置停滚计时。 */
  const listener = (event: Event) => {
    if (!(event instanceof WheelEvent)) return;
    event.preventDefault();
    last = input(event);
    if (timer === undefined && !control.start(last)) return;
    clearTimeout(timer);
    const delta = event.deltaY * (units[event.deltaMode] ?? 1);
    control.nudge({
      matrix: plane.around(
        { x: event.clientX, y: event.clientY },
        plane.scale(Math.exp(-delta * speed)),
      ),
      space: "screen",
    });
    timer = setTimeout(finish, 150);
  };
  element.addEventListener("wheel", listener, { passive: false });
  return () => {
    element.removeEventListener("wheel", listener);
    finish();
  };
}

/**
 * 滚轮输入源：在句柄上滚动时绕指针缩放；`Zoomable` 默认带上。
 *
 * 只挂在句柄上；缩放上下限由 `limits` 插件负责。
 *
 * @param speed 缩放速率：每像素滚动量对应的对数缩放，缺省为 0.0015；
 *   例如 `deltaY` 为 100（常见的一格滚轮）时缩放 `exp(∓0.15)`，约 0.86 或 1.16 倍。
 * @returns 输入源。
 * @example
 * new Zoomable(world, { viewport, sensors: [pointer(), keyboard(), wheel(0.003)] });
 */
export const wheel =
  (speed = 0.0015): Sensor =>
  (control, { element, kind }) =>
    kind === "handle" ? attach(element, control, speed) : undefined;

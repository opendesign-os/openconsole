/**
 * @file 滚轮输入源：绕指针缩放，连续滚动合并为一次会话，停滚 150ms 后结束。
 */

import { plane } from "@openconsole/matrix";

import type { Input } from "../core";
import { input, type Control, type Sensor } from "./sensor";

/** `deltaMode` 换算成像素的系数：像素、行、页。 */
const units = [1, 16, 800];

/**
 * 在元素上监听滚轮：首次滚动开始会话，每次滚动以屏幕空间的缩放 `Step` 推进，150ms 无滚动即结束。
 *
 * 缩放倍数为 `exp(−delta·speed)`，绕指针所在点；监听不是 passive，以便阻止页面滚动。
 * @param element 句柄元素。
 * @param control 它的绑定。
 * @param speed 每像素滚动量对应的对数缩放速率。
 * @returns 清理函数：摘除监听，进行中的会话随即结束。
 */
function attach(element: Element, control: Control, speed: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: Input = { points: [] };
  const finish = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    control.end(last);
  };
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
 * @param [speed=0.0015] 缩放速率：每像素滚动量对应的对数缩放。
 * @returns 输入源。
 * @example
 * new Zoomable(world, { viewport, sensors: [pointer(), keyboard(), wheel(0.003)] });
 */
export const wheel =
  (speed = 0.0015): Sensor =>
  (control, { element, kind }) =>
    kind === "handle" ? attach(element, control, speed) : undefined;

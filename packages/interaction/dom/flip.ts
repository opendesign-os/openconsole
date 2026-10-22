/**
 * @file FLIP 过渡：记录位置，布局变化后从旧位置过渡到新位置；抓起时立即结束过渡。
 *
 * 过渡作用在 CSS `translate` 属性上并带 `id: "flip"`，与 View 写入的 `transform` 叠加、互不覆盖。
 */

import { plane } from "@openconsole/matrix";

import { linear } from "./measure";
import { reset, View } from "./view";

/** FLIP 过渡的动画 id，抓起时据此找出它们。 */
const flip = "flip";

/**
 * 抓起前结束文档里所有 FLIP 过渡，并把被抓节点的视觉偏移折进状态，使它停在屏幕上看到的位置。
 *
 * 不这样做，测量会落在过渡中途，或者过渡结束后节点跳离光标。
 * @param node 即将开始会话的节点。
 */
export function hold(node: HTMLElement): void {
  const running = node.ownerDocument
    .getAnimations()
    .filter(({ id }) => id === flip);
  if (running.length === 0) return;
  const before = node.getBoundingClientRect();
  for (const animation of running) animation.finish();
  const after = node.getBoundingClientRect();
  const inverse = plane.invert(linear(node));
  if (!inverse) return;
  const shift = plane.apply(inverse, {
    x: before.left - after.left,
    y: before.top - after.top,
  });
  const { store } = View.of(node);
  store.commit({
    matrix: plane.multiply(
      plane.translate(shift.x, shift.y),
      store.state.matrix,
    ),
  });
}

/**
 * 记录元素当前的屏幕矩形，作为 FLIP 的起点；在改动布局之前调用。
 * @param elements 将要移动的元素。
 * @returns 元素 → 屏幕矩形。
 */
export function record(
  elements: Iterable<HTMLElement>,
): Map<HTMLElement, DOMRect> {
  return new Map(
    [...elements].map((element): [HTMLElement, DOMRect] => [
      element,
      element.getBoundingClientRect(),
    ]),
  );
}

/**
 * 布局变化后播放 FLIP：每个元素从记录的旧位置过渡回新位置。
 *
 * 先确保元素已被 View 接管，免得接管时把过渡中的 `translate` 折进状态；
 * 位移按祖先的线性变换换算到局部空间，不足 0.5px 的跳过。
 * @param rects {@link record} 的结果。
 * @param [duration=150] 时长（毫秒），不大于 0 时不播放。
 */
export function play(
  rects: ReadonlyMap<HTMLElement, DOMRect>,
  duration = 150,
): void {
  if (duration <= 0) return;
  for (const [element, before] of rects) {
    View.of(element);
    const after = element.getBoundingClientRect();
    const inverse = plane.invert(linear(element));
    if (!inverse) continue;
    const shift = plane.apply(inverse, {
      x: before.left - after.left,
      y: before.top - after.top,
    });
    if (Math.hypot(shift.x, shift.y) < 0.5) continue;
    element.animate(
      [{ translate: `${shift.x}px ${shift.y}px` }, { translate: "0px 0px" }],
      { duration, easing: "ease", id: flip },
    );
  }
}

/**
 * 让节点带过渡回到布局位置，例如松手时没有落到任何目标。会话中调用时状态不变（被锁）。
 * @param node 节点。
 * @param [duration] 时长（毫秒），缺省为 150。
 */
export function restore(node: HTMLElement, duration?: number): void {
  const rects = record([node]);
  reset(node);
  play(rects, duration);
}

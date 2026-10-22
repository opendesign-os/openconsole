/**
 * @file FLIP 过渡：记录位置，布局变化后从旧位置过渡到新位置；抓起时立即结束过渡。
 *
 * FLIP 即 First（记录旧位置）、Last（改动布局后测新位置）、Invert（求两者之差）、Play（从差值过渡到 0）。
 * 过渡用 Web Animations 作用在 CSS `translate` 属性上并带 `id: "flip"`，与 View 写入的 `transform`
 * 叠加、互不覆盖；`translate` 位于自身变换之外，所以位移按容器空间计算。
 */

import { plane } from "@openconsole/matrix";

import { linear } from "./measure";
import { reset, View } from "./view";

/** FLIP 过渡的动画 id（`Animation.id`），抓起时据此从 `document.getAnimations()` 里找出它们。 */
const flip = "flip";

/**
 * 抓起前结束文档里所有 FLIP 过渡，并把被抓节点的视觉偏移折进状态，使它停在屏幕上看到的位置。
 *
 * 不这样做，测量会落在过渡中途，或者过渡结束后节点跳离光标。做法：结束过渡前后各量一次屏幕包围盒，
 * 位移经祖先线性变换的逆换到容器空间，左乘到状态矩阵上。由 `Binding.start` 在加锁之后调用，
 * 所以直接 `commit`，不受会话锁限制；没有进行中的过渡时不做任何事，祖先变换不可逆时只结束过渡。
 *
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
 * 记录元素当前的屏幕矩形，作为 FLIP 的起点（First）；在改动布局之前调用。
 *
 * @param elements 将要移动的元素，可以是任意可迭代对象，重复的元素只记一次。
 * @returns 元素 → 屏幕矩形（`getBoundingClientRect`，已含全部变换），交给 {@link play}。
 * @example
 * const rects = record(items); // items: HTMLElement[]
 * list.prepend(item); // 改动布局
 * play(rects); // 被挤动的条目从旧位置滑到新位置
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
 * 新旧屏幕矩形左上角之差经祖先线性变换的逆换到容器空间（`translate` 属性作用的空间），
 * 不足 0.5px 的跳过；过渡曲线为 `ease`，从该位移过渡到 `0px 0px`。
 *
 * @param rects {@link record} 的结果。
 * @param duration 时长（毫秒），缺省为 150；不大于 0 时直接返回，不接管也不播放。
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
 * 让节点带过渡回到布局位置，例如松手时没有落到任何目标。
 *
 * 依次 {@link record}、`reset`（矩阵设为布局位置）、{@link play}。会话中调用时状态被锁，
 * `reset` 不生效，节点原地不动。
 *
 * @param node 节点。
 * @param duration 时长（毫秒），缺省为 150；不大于 0 时直接跳回，不播放过渡。
 */
export function restore(node: HTMLElement, duration?: number): void {
  const rects = record([node]);
  reset(node);
  play(rects, duration);
}

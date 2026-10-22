import { plane } from "@openconsole/matrix";

import { linear } from "./measure";
import { reset, View } from "./view";

const flip = "flip";

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

export function restore(node: HTMLElement, duration?: number): void {
  const rects = record([node]);
  reset(node);
  play(rects, duration);
}

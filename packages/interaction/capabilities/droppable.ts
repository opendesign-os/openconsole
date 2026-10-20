import { plane, type Point } from "@openconsole/matrix";

import { center, frame } from "../core";
import { linear, observe, own, rect, size, type Session } from "../dom";

export interface Drag {
  readonly node: HTMLElement;
  readonly data: unknown;
  readonly point: Point<2>;
}

export type Detect = (zone: HTMLElement, drag: Drag) => number | undefined;

export interface DroppableOptions {
  readonly accept?: (drag: Drag) => boolean;
  readonly detect?: Detect;
  readonly onEnter?: (drag: Drag) => void;
  readonly onOver?: (drag: Drag) => void;
  readonly onLeave?: (drag: Drag) => void;
  readonly onDrop?: (drag: Drag) => void;
}

export function within(zone: HTMLElement, drag: Drag): number | undefined {
  const box = size(zone);
  const inverse = frame(plane.multiply(linear(zone), own(zone)), rect(zone), {
    matrix: plane.identity,
    size: box,
  });
  if (!inverse) return undefined;
  const { x, y } = plane.apply(inverse, drag.point);
  return x >= 0 && y >= 0 && x <= box.width && y <= box.height ? 1 : undefined;
}

const zones = new Map<HTMLElement, DroppableOptions>();
let over: HTMLElement | undefined;
let release: (() => void) | undefined;

function locate(session: Session): Point<2> {
  const { points } = session.input;
  if (points.length > 0) {
    const sum = points.reduce(
      (total, point) => ({ x: total.x + point.x, y: total.y + point.y }),
      { x: 0, y: 0 },
    );
    return { x: sum.x / points.length, y: sum.y / points.length };
  }
  const inverse = plane.invert(session.frame);
  const middle = center(session.state);
  return inverse ? plane.apply(inverse, middle) : middle;
}

const describe = (session: Session): Drag => ({
  node: session.node,
  data: session.data,
  point: locate(session),
});

function hit(drag: Drag): HTMLElement | undefined {
  let best: { zone: HTMLElement; score: number } | undefined;
  for (const [zone, options] of zones) {
    if (zone === drag.node || drag.node.contains(zone)) continue;
    if (options.accept && !options.accept(drag)) continue;
    const score = (options.detect ?? within)(zone, drag);
    if (score === undefined) continue;
    const inner = best?.zone.contains(zone) ?? true;
    const outer = best ? zone.contains(best.zone) : false;
    if (!best || inner || (!outer && score > best.score)) {
      best = { zone, score };
    }
  }
  return best?.zone;
}

function track(session: Session): void {
  if (!session.action.freedom.translate) return;
  const drag = describe(session);
  const next = hit(drag);
  if (next === over) {
    if (over) zones.get(over)?.onOver?.(drag);
    return;
  }
  if (over) zones.get(over)?.onLeave?.(drag);
  over = next;
  if (next) zones.get(next)?.onEnter?.(drag);
}

function finish(session: Session, drop: boolean): void {
  const zone = over;
  over = undefined;
  if (!zone) return;
  const drag = describe(session);
  const options = zones.get(zone);
  if (drop) options?.onDrop?.(drag);
  else options?.onLeave?.(drag);
}

const observer = {
  onStart: track,
  onMove: track,
  onEnd: (session: Session) => finish(session, true),
  onCancel: (session: Session) => finish(session, false),
};

export class Droppable {
  readonly node: HTMLElement;

  constructor(zone: HTMLElement, options: DroppableOptions = {}) {
    this.node = zone;
    zones.set(zone, options);
    release ??= observe(observer);
  }

  destroy(): this {
    zones.delete(this.node);
    if (over === this.node) over = undefined;
    if (zones.size === 0) {
      release?.();
      release = undefined;
    }
    return this;
  }

  [Symbol.dispose](): void {
    this.destroy();
  }
}

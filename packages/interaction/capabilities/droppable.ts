import { plane, type Point } from "@openconsole/matrix";

import { centroid, choose, frame, type Candidate } from "../core";
import { linear, observe, own, rect, size, type Session } from "../dom";
import {
  Capability,
  center,
  type CapabilityOptions,
  type Part,
} from "../model";

export interface Drag {
  readonly node: HTMLElement;
  readonly data: unknown;
  readonly point: Point<2>;
}

export type Detect = (zone: HTMLElement, drag: Drag) => number | undefined;

export interface DroppableOptions extends CapabilityOptions {
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

function locate(session: Session): Point<2> {
  const { points } = session.input;
  if (points.length > 0) return centroid(points);
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
  const candidates: Candidate<HTMLElement>[] = [];
  for (const [zone, options] of zones) {
    if (zone === drag.node || drag.node.contains(zone)) continue;
    if (options.accept && !options.accept(drag)) continue;
    const score = (options.detect ?? within)(zone, drag);
    if (score !== undefined) candidates.push({ target: zone, score });
  }
  return choose(candidates, (outer, inner) => outer.contains(inner));
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

export class Droppable extends Capability<HTMLElement, DroppableOptions> {
  constructor(zone: HTMLElement, options: DroppableOptions = {}) {
    super(zone, options);
    this.refresh();
  }

  get active(): boolean {
    return over === this.node;
  }

  protected build(): readonly Part[] {
    const { node } = this;
    zones.set(node, this.options);
    const stop = observe(observer);
    return [
      () => {
        zones.delete(node);
        if (over === node) over = undefined;
        if (zones.size === 0) stop();
      },
    ];
  }
}

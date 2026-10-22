import { plane, type Point } from "@openconsole/matrix";

import { choose, hotspot, type Candidate } from "../core";
import { observe, outline, type Session } from "../dom";
import {
  area,
  Capability,
  centroid,
  contains,
  corners,
  intersect,
  type CapabilityOptions,
  type Part,
  type Polygon,
} from "../model";

export interface Drag {
  readonly node: HTMLElement;
  readonly data: unknown;
  readonly point: Point<2>;
  readonly shape: Polygon;
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
  const polygon = outline(zone);
  return polygon && contains(polygon, drag.point) ? 1 : undefined;
}

export function overlap(zone: HTMLElement, drag: Drag): number | undefined {
  const polygon = outline(zone);
  if (!polygon) return undefined;
  const shared = area(intersect(drag.shape, polygon));
  const union = area(drag.shape) + area(polygon) - shared;
  return shared > 0 ? shared / union : undefined;
}

export function nearest(zone: HTMLElement, drag: Drag): number | undefined {
  const polygon = outline(zone);
  if (!polygon) return undefined;
  const from = centroid(drag.shape);
  const to = centroid(polygon);
  return -Math.hypot(to.x - from.x, to.y - from.y);
}

const zones = new Map<HTMLElement, DroppableOptions>();
let over: HTMLElement | undefined;

function describe(session: Session): Drag {
  const inverse = plane.invert(session.frame);
  const polygon = corners(session.state);
  const shape = inverse
    ? polygon.map((point) => plane.apply(inverse, point))
    : polygon;
  return {
    node: session.node,
    data: session.data,
    point: hotspot(session) ?? centroid(shape),
    shape,
  };
}

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

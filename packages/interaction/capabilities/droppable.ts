import { plane, type Matrix, type Point } from "@openconsole/matrix";

import { choose, hotspot, Linear, type Candidate, type Index } from "../core";
import { observe, outline, type Session } from "../dom";
import {
  area,
  Capability,
  centroid,
  contains,
  corners,
  extent,
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

export interface Zone {
  readonly element: HTMLElement;
  readonly shape: Polygon;
}

export type Detect = (zone: Zone, drag: Drag) => number | undefined;

export interface DroppableOptions extends CapabilityOptions {
  readonly accept?: (drag: Drag) => boolean;
  readonly detect?: Detect;
  readonly onEnter?: (drag: Drag) => void;
  readonly onOver?: (drag: Drag) => void;
  readonly onLeave?: (drag: Drag) => void;
  readonly onDrop?: (drag: Drag) => void;
}

export const within: Detect = (zone, drag) =>
  contains(zone.shape, drag.point) ? 1 : undefined;

export const overlap: Detect = (zone, drag) => {
  const shared = area(intersect(drag.shape, zone.shape));
  const union = area(drag.shape) + area(zone.shape) - shared;
  return shared > 0 ? shared / union : undefined;
};

export const nearest: Detect = (zone, drag) => {
  const from = centroid(drag.shape);
  const to = centroid(zone.shape);
  return -Math.hypot(to.x - from.x, to.y - from.y);
};

const zones = new Map<HTMLElement, DroppableOptions>();
let over: HTMLElement | undefined;
let measured: Matrix<2, "affine"> | undefined;

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

function measure(drag: Drag): void {
  const { index } = Droppable;
  index.clear();
  for (const [element, options] of zones) {
    if (element === drag.node || drag.node.contains(element)) continue;
    if (options.accept && !options.accept(drag)) continue;
    const shape = outline(element);
    if (shape) index.insert({ element, shape }, extent(shape));
  }
}

function hit(drag: Drag): HTMLElement | undefined {
  const candidates: Candidate<HTMLElement>[] = [];
  for (const zone of Droppable.index.search(
    extent([...drag.shape, drag.point]),
  )) {
    const options = zones.get(zone.element);
    const score = options && (options.detect ?? within)(zone, drag);
    if (score !== undefined) candidates.push({ target: zone.element, score });
  }
  return choose(candidates, (outer, inner) => outer.contains(inner));
}

function track(session: Session): void {
  if (!session.action.freedom.translate) return;
  const drag = describe(session);
  if (session.frame !== measured) {
    measured = session.frame;
    measure(drag);
  }
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
  measured = undefined;
  Droppable.index.clear();
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
  static index: Index<Zone> = new Linear();

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
    measured = undefined;
    const stop = observe(observer);
    return [
      () => {
        zones.delete(node);
        if (over === node) over = undefined;
        if (zones.size === 0) stop();
      },
    ];
  }

  protected apply(): boolean {
    zones.set(this.node, this.options);
    measured = undefined;
    return true;
  }
}

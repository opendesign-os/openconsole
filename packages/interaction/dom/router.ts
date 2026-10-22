import type { Point } from "@openconsole/matrix";

import type { Input } from "../core";

export interface Activation {
  readonly distance?: number;
  readonly delay?: number;
  readonly tolerance?: number;
}

export const deliberate = (type: string): Activation =>
  type === "touch" ? { delay: 250, tolerance: 5 } : { distance: 3 };

export interface Target {
  limit(): number;
  activation(type: string): Activation;
  start(input: Input): boolean;
  move(input: Input): void;
  end(input: Input): void;
  cancel(): void;
}

export interface Marker {
  readonly target: Target;
  readonly kind: "handle" | "ignore";
  readonly priority: number;
}

type Lookup = (element: EventTarget) => readonly Marker[] | undefined;

interface Session {
  readonly target: Target;
  readonly handle: Element;
  readonly activation: Activation;
  readonly controller: AbortController;
  readonly presses: Map<number, Point<2>>;
  readonly pointers: Map<number, Point<2>>;
  readonly first: PointerEvent;
  last: PointerEvent;
  started: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
}

const interactive =
  "input, textarea, select, button, option, [contenteditable]:not([contenteditable='false'])";

const markers = new WeakMap<EventTarget, readonly Marker[]>();
let session: Session | undefined;

export const input = (
  event: MouseEvent | KeyboardEvent,
  points: Iterable<Point<2>> = [],
): Input => ({
  points: [...points],
  modifiers: {
    shift: event.shiftKey,
    alt: event.altKey,
    control: event.ctrlKey,
    meta: event.metaKey,
  },
  event,
  timestamp: event.timeStamp,
});

const locate = (event: PointerEvent): Point<2> => ({
  x: event.clientX,
  y: event.clientY,
});

function allows(
  path: readonly EventTarget[],
  target: Target,
  find: Lookup,
): boolean {
  let best = -Infinity;
  let allowed = false;
  for (const element of path) {
    for (const marker of find(element) ?? []) {
      if (marker.target !== target || marker.priority <= best) continue;
      best = marker.priority;
      allowed = marker.kind === "handle";
    }
  }
  return allowed;
}

function pick(
  path: readonly EventTarget[],
  find: Lookup,
): { handle: EventTarget; target: Target } | undefined {
  for (const element of path) {
    const handles = (find(element) ?? [])
      .filter((marker) => marker.kind === "handle")
      .sort((left, right) => right.priority - left.priority);
    for (const { target } of handles) {
      if (allows(path, target, find)) return { handle: element, target };
    }
  }
  return undefined;
}

function blocked(path: readonly EventTarget[], handle: Element): boolean {
  for (const element of path) {
    if (element === handle) return false;
    if (element instanceof Element && element.matches(interactive)) return true;
  }
  return false;
}

function capture(element: Element, id: number): void {
  try {
    element.setPointerCapture(id);
  } catch {
    return;
  }
}

function suppress(document: Document): void {
  const swallow = (event: Event) => {
    event.stopPropagation();
    event.preventDefault();
  };
  document.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(
    () => document.removeEventListener("click", swallow, { capture: true }),
    0,
  );
}

function prevent(event: Event): void {
  event.preventDefault();
}

function begin(current: Session): void {
  if (current.started || session !== current) return;
  const { handle, target, presses, pointers, first } = current;
  if (!target.start(input(first, presses.values()))) {
    finish(current, "cancel", []);
    return;
  }
  current.started = true;
  for (const id of pointers.keys()) capture(handle, id);
  const document = handle.ownerDocument;
  const clear = () => document.getSelection()?.removeAllRanges();
  clear();
  document.addEventListener("selectionchange", clear, {
    signal: current.controller.signal,
  });
  target.move(input(current.last, pointers.values()));
}

function finish(
  current: Session,
  kind: "end" | "cancel",
  points: readonly Point<2>[],
): void {
  if (session !== current) return;
  session = undefined;
  current.controller.abort();
  if (current.timer !== undefined) clearTimeout(current.timer);
  if (!current.started) return;
  const { handle, target } = current;
  for (const id of current.presses.keys()) {
    if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
  }
  if (kind === "cancel") {
    target.cancel();
    return;
  }
  target.end(input(current.last, points));
  suppress(handle.ownerDocument);
}

function join(current: Session, event: PointerEvent): void {
  if (current.pointers.size >= current.target.limit()) return;
  if (!event.composedPath().includes(current.handle)) return;
  const point = locate(event);
  current.presses.set(event.pointerId, point);
  current.pointers.set(event.pointerId, point);
  current.last = event;
  if (!current.started) return;
  capture(current.handle, event.pointerId);
  current.target.move(input(event, current.pointers.values()));
}

function down(event: PointerEvent): void {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (session) {
    join(session, event);
    return;
  }
  const path = event.composedPath();
  const found = pick(path, (element) => markers.get(element));
  if (!found || !(found.handle instanceof Element)) return;
  const handle = found.handle;
  if (blocked(path, handle)) return;
  const activation = found.target.activation(event.pointerType);
  const point = locate(event);
  const current: Session = {
    target: found.target,
    handle,
    activation,
    controller: new AbortController(),
    presses: new Map([[event.pointerId, point]]),
    pointers: new Map([[event.pointerId, point]]),
    first: event,
    last: event,
    started: false,
    timer: undefined,
  };
  session = current;
  const options = { capture: true, signal: current.controller.signal };
  const document = handle.ownerDocument;
  document.addEventListener("pointermove", move, options);
  document.addEventListener("pointerup", up, options);
  document.addEventListener("pointercancel", cancel, options);
  document.addEventListener("lostpointercapture", lost, options);
  document.addEventListener("dragstart", prevent, options);
  document.addEventListener("keydown", escape, options);
  document.addEventListener("touchmove", touch, { ...options, passive: false });
  if (activation.delay !== undefined) {
    current.timer = setTimeout(() => begin(current), activation.delay);
  }
}

function move(event: PointerEvent): void {
  const current = session;
  if (!current || !current.pointers.has(event.pointerId)) return;
  current.pointers.set(event.pointerId, locate(event));
  current.last = event;
  if (current.started) {
    current.target.move(input(event, current.pointers.values()));
    return;
  }
  const { delay, tolerance = 0, distance = 0 } = current.activation;
  const moved = Math.hypot(
    event.clientX - current.first.clientX,
    event.clientY - current.first.clientY,
  );
  if (delay !== undefined) {
    if (moved > tolerance) finish(current, "cancel", []);
    return;
  }
  if (moved >= distance) begin(current);
}

function up(event: PointerEvent): void {
  const current = session;
  if (!current || !current.pointers.has(event.pointerId)) return;
  current.pointers.delete(event.pointerId);
  current.last = event;
  if (current.pointers.size === 0) {
    finish(current, "end", [locate(event)]);
    return;
  }
  if (current.started) {
    current.target.move(input(event, current.pointers.values()));
  }
}

function cancel(event: PointerEvent): void {
  if (session?.pointers.has(event.pointerId)) finish(session, "cancel", []);
}

function lost(event: PointerEvent): void {
  const current = session;
  if (!current?.started || !current.pointers.has(event.pointerId)) return;
  finish(current, "end", [...current.pointers.values()]);
}

function escape(event: KeyboardEvent): void {
  if (event.key !== "Escape" || !session) return;
  event.preventDefault();
  finish(session, "cancel", []);
}

function touch(event: TouchEvent): void {
  if (session?.started && event.cancelable) event.preventDefault();
}

export function register(element: Element, marker: Marker): () => void {
  markers.set(element, [...(markers.get(element) ?? []), marker]);
  element.ownerDocument.addEventListener("pointerdown", down, {
    capture: true,
    passive: true,
  });
  const style =
    marker.kind === "handle" &&
    (element instanceof HTMLElement || element instanceof SVGElement)
      ? element.style
      : undefined;
  const saved = style?.touchAction;
  if (style) {
    style.touchAction =
      marker.target.activation("touch").delay === undefined
        ? "none"
        : "manipulation";
  }
  return () => {
    const rest = (markers.get(element) ?? []).filter((item) => item !== marker);
    if (rest.length > 0) markers.set(element, rest);
    else markers.delete(element);
    if (style && saved !== undefined) style.touchAction = saved;
  };
}

export function forget(target: Target): void {
  if (session?.target === target) finish(session, "cancel", []);
}

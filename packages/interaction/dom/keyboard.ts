import { plane } from "@openconsole/matrix";

import type { Input, Step } from "../core";
import { input, type Control, type Keys, type Sensor } from "./sensor";

export function arrows(x: number, y = x): Keys {
  const move = (right: number, down: number): Step => ({
    matrix: plane.translate(right * x, down * y),
    space: "container",
  });
  return {
    ArrowLeft: move(-1, 0),
    ArrowRight: move(1, 0),
    ArrowUp: move(0, -1),
    ArrowDown: move(0, 1),
    "Shift+ArrowLeft": move(-10, 0),
    "Shift+ArrowRight": move(10, 0),
    "Shift+ArrowUp": move(0, -10),
    "Shift+ArrowDown": move(0, 10),
  };
}

const controls = new WeakMap<Element, Control>();
let active:
  | { readonly element: Element; readonly control: Control }
  | undefined;

const grabs = (key: string): boolean => key === " " || key === "Enter";

function blur(): void {
  stop("end", { points: [] });
}

function stop(kind: "end" | "cancel", last: Input): void {
  const current = active;
  if (!current) return;
  active = undefined;
  current.element.removeEventListener("blur", blur);
  if (kind === "end") current.control.end(last);
  else current.control.cancel();
}

function down(event: KeyboardEvent): void {
  if (event.defaultPrevented) return;
  if (active) {
    const { control } = active;
    if (event.key === "Escape" || grabs(event.key)) {
      event.preventDefault();
      stop(event.key === "Escape" ? "cancel" : "end", input(event));
      return;
    }
    const name = event.shiftKey ? `Shift+${event.key}` : event.key;
    const key = control.keys[name] ?? control.keys[event.key];
    if (!key) return;
    event.preventDefault();
    const step = typeof key === "function" ? key(control.state) : key;
    if (step) control.nudge(step);
    return;
  }
  if (!grabs(event.key) || !(event.target instanceof Element)) return;
  const element = event.target;
  const control = controls.get(element);
  if (!control || !control.start(input(event))) return;
  event.preventDefault();
  active = { element, control };
  element.addEventListener("blur", blur, { once: true });
}

function listen(element: Element, control: Control): () => void {
  controls.set(element, control);
  element.ownerDocument.addEventListener("keydown", down);
  const focus =
    element instanceof HTMLElement &&
    !element.hasAttribute("tabindex") &&
    element.tabIndex < 0;
  if (focus) element.tabIndex = 0;
  return () => {
    if (controls.get(element) === control) controls.delete(element);
    if (focus) element.removeAttribute("tabindex");
    if (active?.control === control) stop("cancel", { points: [] });
  };
}

export const keyboard =
  (): Sensor =>
  (control, { element, kind }) =>
    kind === "handle" && Object.keys(control.keys).length > 0
      ? listen(element, control)
      : undefined;

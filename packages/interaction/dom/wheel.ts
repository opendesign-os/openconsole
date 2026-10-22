import { plane } from "@openconsole/matrix";

import type { Input } from "../core";
import { input, type Control, type Sensor } from "./sensor";

const units = [1, 16, 800];

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

export const wheel =
  (speed = 0.0015): Sensor =>
  (control, { element, kind }) =>
    kind === "handle" ? attach(element, control, speed) : undefined;

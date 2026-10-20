import { plane } from "@openconsole/matrix";

import type { Input, Step } from "../core";
import { input } from "./router";

interface Spin {
  start(input: Input): boolean;
  nudge(step: Step): void;
  end(input: Input): void;
}

const units = [1, 16, 800];

export function wheel(
  element: HTMLElement,
  target: Spin,
  speed: number,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: Input = { points: [] };
  const finish = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    target.end(last);
  };
  const listener = (event: WheelEvent) => {
    event.preventDefault();
    last = input(event);
    if (timer === undefined && !target.start(last)) return;
    clearTimeout(timer);
    const delta = event.deltaY * (units[event.deltaMode] ?? 1);
    target.nudge({
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

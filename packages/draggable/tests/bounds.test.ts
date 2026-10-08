import { describe, expect, it } from "vitest";

import { space } from "@openconsole/matrix";

import { Tracker } from "../core/tracker";
import { bounds, type Bounds } from "../plugins/bounds";
import { grid } from "../plugins/grid";

const area: Bounds = { left: 0, top: 0, right: 520, bottom: 320 };

const drag = (tracker: Tracker, x: number, y: number): Tracker =>
  tracker.start({ x: 0, y: 0 }).move({ x, y }).end({ x, y });

describe("bounds", () => {
  it("keeps the translation inside the area on every side", () => {
    const tracker = new Tracker({
      matrix: space.translate(100, 100, 0),
      plugins: [bounds(() => area)],
    });
    drag(tracker, 900, 900);
    expect(space.round(tracker.matrix)).toEqual(space.translate(520, 320, 0));
    drag(tracker, -900, -900);
    expect(space.round(tracker.matrix)).toEqual(space.identity);
  });

  it("measures the area again at every drag start", () => {
    let right = 520;
    const tracker = new Tracker({
      plugins: [bounds(() => ({ ...area, right }))],
    });
    drag(tracker, 600, 0);
    right = 300;
    drag(tracker, 50, 0);
    expect(space.round(tracker.matrix)).toEqual(space.translate(300, 0, 0));
  });

  it("wins over grid when listed after it", () => {
    const tracker = new Tracker({
      matrix: space.translate(500, 0, 0),
      plugins: [grid(30), bounds(() => area)],
    });
    drag(tracker, 25, 0);
    expect(space.round(tracker.matrix)).toEqual(space.translate(520, 0, 0));
  });
});

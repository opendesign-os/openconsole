import { describe, expect, it } from "vitest";

import { plane } from "@openconsole/matrix";

import { extent, resize, Tracker, transform, type Bounds } from "../core";
import { bounds, grid } from "../plugins";

const area: Bounds = { left: 0, top: 0, right: 520, bottom: 320 };

const drag = (tracker: Tracker, x: number, y: number): Tracker =>
  tracker
    .start({ points: [{ x: 0, y: 0 }] })
    .move({ points: [{ x, y }] })
    .end();

describe("bounds", () => {
  it("keeps the box inside the area on every side", () => {
    const tracker = new Tracker({
      matrix: plane.translate(100, 100),
      size: { width: 20, height: 10 },
      plugins: [bounds(() => area)],
    });
    drag(tracker, 900, 900);
    expect(plane.round(tracker.state.matrix)).toEqual(
      plane.translate(500, 310),
    );
    drag(tracker, -900, -900);
    expect(plane.round(tracker.state.matrix)).toEqual(plane.identity);
  });

  it("measures the area again at every session start", () => {
    let right = 520;
    const tracker = new Tracker({
      plugins: [bounds(() => ({ ...area, right }))],
    });
    drag(tracker, 600, 0);
    right = 300;
    drag(tracker, 50, 0);
    expect(plane.round(tracker.state.matrix)).toEqual(plane.translate(300, 0));
  });

  it("wins over grid when listed after it", () => {
    const tracker = new Tracker({
      matrix: plane.translate(500, 0),
      plugins: [grid(30), bounds(() => area)],
    });
    drag(tracker, 25, 0);
    expect(plane.round(tracker.state.matrix)).toEqual(plane.translate(520, 0));
  });

  it("keeps a rotated box inside the area", () => {
    const tracker = new Tracker({
      matrix: plane.multiply(
        plane.translate(200, 100),
        plane.around({ x: 50, y: 50 }, plane.rotate(Math.PI / 4)),
      ),
      size: { width: 100, height: 100 },
      plugins: [bounds(() => area)],
    });
    drag(tracker, 1000, 0);
    const box = extent(tracker.state);
    expect(box.right).toBeCloseTo(area.right, 9);
    expect(box.left).toBeGreaterThan(area.left);
  });

  it("clamps the moving edge of a resize and keeps the anchor fixed", () => {
    const tracker = new Tracker({
      matrix: plane.translate(100, 100),
      size: { width: 100, height: 50 },
      action: resize({ handle: { x: 1, y: 0 } }),
      plugins: [bounds(() => area)],
    });
    drag(tracker, 1000, 0);
    expect(tracker.state.size.width).toBeCloseTo(420, 9);
    expect(plane.round(tracker.state.matrix)).toEqual(
      plane.translate(100, 100),
    );
  });

  it("keeps the previous state when a rotation would leave the area", () => {
    const tracker = new Tracker({
      matrix: plane.translate(0, 0),
      size: { width: 100, height: 20 },
      action: transform({ rotate: true }),
      plugins: [bounds(() => area)],
    });
    drag(tracker, 0, 60);
    expect(tracker.state.matrix).toEqual(plane.identity);
  });
});

import { describe, expect, it } from "vitest";

import { plane } from "@openconsole/matrix";

import { resize, Tracker, transform } from "../core";
import { bounds, limits } from "../plugins";

describe("limits", () => {
  it("clamps the size along the moving edges", () => {
    const tracker = new Tracker({
      size: { width: 50, height: 50 },
      action: resize({ handle: { x: 1, y: 1 } }),
      plugins: [limits({ width: { min: 40, max: 80 }, height: { min: 45 } })],
    });
    tracker.start({ points: [{ x: 0, y: 0 }] });
    tracker.move({ points: [{ x: 100, y: -30 }] });
    expect(tracker.state.size).toEqual({ width: 80, height: 45 });
  });

  it("clamps the scale around the anchor", () => {
    const tracker = new Tracker({
      action: transform({ translate: true, scale: true }),
      plugins: [limits({ scale: { max: 2 } })],
    });
    tracker.start({
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    });
    tracker.move({
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
      ],
    });
    const [a, b] = tracker.state.matrix;
    expect(Math.hypot(a, b)).toBeCloseTo(2, 9);
    const fixed = plane.apply(tracker.state.matrix, { x: 5, y: 0 });
    expect(fixed.x).toBeCloseTo(20, 9);
    expect(fixed.y).toBeCloseTo(0, 9);
  });

  it("wins over bounds when listed after it", () => {
    const tracker = new Tracker({
      size: { width: 50, height: 50 },
      action: resize({ handle: { x: 1, y: 0 } }),
      plugins: [
        bounds(() => ({ left: 0, top: 0, right: 300, bottom: 300 })),
        limits({ width: { max: 120 } }),
      ],
    });
    tracker.start({ points: [{ x: 0, y: 0 }] });
    tracker.move({ points: [{ x: 500, y: 0 }] });
    expect(tracker.state.size.width).toBe(120);
  });
});

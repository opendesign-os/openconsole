import { describe, expect, it } from "vitest";

import { plane } from "@openconsole/matrix";

import { Tracker, transform } from "../core";
import { angle } from "../plugins";

const quarter = Math.PI / 12;

describe("angle", () => {
  it("snaps the rotation to multiples of the step around the pivot", () => {
    const tracker = new Tracker({
      action: transform({ rotate: true }),
      plugins: [angle(quarter)],
    }).assign({ size: { width: 100, height: 100 } });
    const turn = 0.3;
    tracker.start({ points: [{ x: 150, y: 50 }] });
    tracker.move({
      points: [{ x: 50 + 100 * Math.cos(turn), y: 50 + 100 * Math.sin(turn) }],
    });
    const [a, b] = tracker.state.matrix;
    expect(Math.atan2(b, a)).toBeCloseTo(quarter, 9);
    const pivot = plane.apply(tracker.state.matrix, { x: 50, y: 50 });
    expect(pivot.x).toBeCloseTo(50, 9);
    expect(pivot.y).toBeCloseTo(50, 9);
  });

  it("leaves actions without rotation alone", () => {
    const tracker = new Tracker({ plugins: [angle(quarter)] });
    tracker.start({ points: [{ x: 0, y: 0 }] });
    tracker.move({ points: [{ x: 7, y: 3 }] });
    expect(plane.round(tracker.state.matrix)).toEqual(plane.translate(7, 3));
  });

  it("rejects a step that is not positive and finite", () => {
    for (const step of [0, -1, Number.NaN, Infinity]) {
      expect(() => angle(step)).toThrow(RangeError);
    }
  });
});

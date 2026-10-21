import { describe, expect, it } from "vitest";

import { plane } from "@openconsole/matrix";

import { resize, Tracker } from "../core";
import { grid } from "../plugins";

const drag = (tracker: Tracker, x: number, y: number): Tracker =>
  tracker
    .start({ points: [{ x: 0, y: 0 }] })
    .move({ points: [{ x, y }] })
    .end();

describe("grid", () => {
  it("snaps both axes to the step", () => {
    const { state } = drag(new Tracker({ plugins: [grid(10)] }), 27, 34);
    expect(plane.round(state.matrix)).toEqual(plane.translate(30, 30));
  });

  it("snaps the translation itself rather than the movement", () => {
    const tracker = new Tracker({ plugins: [grid(10)] }).assign({
      matrix: plane.translate(3, 0),
    });
    const { state } = drag(tracker, 1, 0);
    expect(plane.round(state.matrix)).toEqual(plane.identity);
  });

  it("rejects a step that is not positive and finite", () => {
    for (const step of [0, -10, Number.NaN, Infinity]) {
      expect(() => grid(step)).toThrow(RangeError);
    }
  });

  it("keeps the linear part", () => {
    const origin = plane.rotate(0.5);
    const { state } = drag(
      new Tracker({ plugins: [grid(10)] }).assign({ matrix: origin }),
      27,
      34,
    );
    expect(state.matrix[4]).toBeCloseTo(30, 9);
    expect(state.matrix[5]).toBeCloseTo(30, 9);
    expect(plane.equals(plane.linear(state.matrix), plane.linear(origin))).toBe(
      true,
    );
  });

  it("snaps the size along the moving edges of a resize", () => {
    const { state } = drag(
      new Tracker({
        action: resize({ handle: { x: 1, y: 0 } }),
        plugins: [grid(10)],
      }).assign({ size: { width: 40, height: 40 } }),
      23,
      17,
    );
    expect(state.size).toEqual({ width: 60, height: 40 });
    expect(state.matrix).toEqual(plane.identity);
  });
});

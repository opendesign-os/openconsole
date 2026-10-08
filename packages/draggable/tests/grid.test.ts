import { describe, expect, it } from "vitest";

import { plane, space } from "@openconsole/matrix";

import { Tracker } from "../core/tracker";
import { grid } from "../plugins/grid";

const drag = (tracker: Tracker, x: number, y: number): Tracker =>
  tracker.start({ x: 0, y: 0 }).move({ x, y }).end({ x, y });

describe("grid", () => {
  it("snaps both axes to the step", () => {
    const { matrix } = drag(new Tracker({ plugins: [grid(10)] }), 27, 34);
    expect(space.round(matrix)).toEqual(space.translate(30, 30, 0));
  });

  it("snaps the translation itself rather than the movement", () => {
    const tracker = new Tracker({
      matrix: space.translate(3, 0, 0),
      plugins: [grid(10)],
    });
    const { matrix } = drag(tracker, 1, 0);
    expect(space.round(matrix)).toEqual(space.identity);
  });

  it("rejects a step that is not positive and finite", () => {
    for (const step of [0, -10, Number.NaN, Infinity]) {
      expect(() => grid(step)).toThrow(RangeError);
    }
  });

  it("keeps the linear part", () => {
    const origin = space.lift(plane.rotate(0.5));
    const { matrix } = drag(
      new Tracker({ matrix: origin, plugins: [grid(10)] }),
      27,
      34,
    );
    expect(matrix[12]).toBeCloseTo(30, 9);
    expect(matrix[13]).toBeCloseTo(30, 9);
    expect(space.equals(space.linear(matrix), space.linear(origin))).toBe(true);
  });
});

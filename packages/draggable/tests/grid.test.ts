import { describe, expect, it } from "vitest";

import { plane, space } from "@openconsole/matrix";

import { Tracker } from "../core/tracker";
import { grid } from "../plugins/grid";

function drag(tracker: Tracker, x: number, y: number): Tracker {
  tracker.start({ x: 0, y: 0 });
  tracker.move({ x, y });
  tracker.end({ x, y });
  return tracker;
}

describe("grid", () => {
  it("snaps both axes to the step", () => {
    const { matrix } = drag(new Tracker({ use: [grid(10)] }), 27, 34);
    expect(space.round(matrix)).toEqual(space.translate(30, 30, 0));
  });

  it("snaps the translation itself rather than the movement", () => {
    const tracker = new Tracker({
      matrix: space.translate(3, 0, 0),
      use: [grid(10)],
    });
    const { matrix } = drag(tracker, 1, 0);
    expect(space.round(matrix)).toEqual(space.identity);
  });

  it("keeps the linear part", () => {
    const origin = space.lift(plane.rotate(0.5));
    const { matrix } = drag(
      new Tracker({ matrix: origin, use: [grid(10)] }),
      27,
      34,
    );
    expect(matrix[12]).toBeCloseTo(30, 9);
    expect(matrix[13]).toBeCloseTo(30, 9);
    expect(space.equals(space.linear(matrix), space.linear(origin))).toBe(true);
  });
});

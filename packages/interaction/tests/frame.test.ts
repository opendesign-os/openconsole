import { describe, expect, it } from "vitest";

import { plane } from "@openconsole/matrix";

import { frame } from "../core";
import { extent, type State } from "../model";

describe("frame", () => {
  it("recovers the screen → container map from the rendered extent", () => {
    const view = plane.multiply(
      plane.translate(320, 140),
      plane.rotate(0.7),
      plane.skew(0.3, 0.1),
      plane.scale(1.4, 0.8),
    );
    const state: State = {
      matrix: plane.multiply(plane.translate(60, 20), plane.rotate(-0.4)),
      size: { width: 120, height: 80 },
    };
    const screen = extent({
      ...state,
      matrix: plane.multiply(view, state.matrix),
    });
    const result = frame(plane.linear(view), screen, state);
    expect(result && plane.round(result, 9)).toEqual(
      plane.round(plane.invert(view) ?? plane.identity, 9),
    );
  });

  it("gives up on a singular linear part", () => {
    expect(
      frame(
        plane.scale(0),
        { left: 0, top: 0, right: 0, bottom: 0 },
        { matrix: plane.identity, size: { width: 10, height: 10 } },
      ),
    ).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";

import { plane, type Point } from "@openconsole/matrix";

import { resize, transform, type Handle, type State } from "../core";

const near = (actual: Point<2>, expected: Point<2>) => {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
};

const base: State = {
  matrix: plane.multiply(
    plane.translate(30, 40),
    plane.rotate(0.4),
    plane.skew(0.2),
  ),
  size: { width: 100, height: 60 },
};

describe("transform", () => {
  it("returns the origin for empty or mismatched points", () => {
    const action = transform({ translate: true });
    expect(action.solve(base, [], [])).toBe(base);
    expect(action.solve(base, [{ x: 0, y: 0 }], [])).toBe(base);
  });

  it("translates by a single point", () => {
    const { matrix } = transform({ translate: true }).solve(
      base,
      [{ x: 0, y: 0 }],
      [{ x: 7, y: -3 }],
    );
    expect(plane.round(matrix)).toEqual(
      plane.round(plane.multiply(plane.translate(7, -3), base.matrix)),
    );
  });

  it("rotates about the pivot with one point when translation is off", () => {
    const pivot = { x: 50, y: 30 };
    const fixed = plane.apply(base.matrix, pivot);
    const start = { x: fixed.x + 100, y: fixed.y };
    const end = { x: fixed.x, y: fixed.y + 100 };
    const { matrix } = transform({ rotate: true, pivot }).solve(
      base,
      [start],
      [end],
    );
    near(plane.apply(matrix, pivot), fixed);
    expect(
      plane.round(
        plane.multiply(matrix, plane.invert(base.matrix) ?? plane.identity),
      ),
    ).toEqual(plane.round(plane.around(fixed, plane.rotate(Math.PI / 2))));
  });

  it("follows a two-point pinch exactly when every freedom is on", () => {
    const from: readonly [Point<2>, Point<2>] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    const to: readonly [Point<2>, Point<2>] = [
      { x: 5, y: 5 },
      { x: 5, y: 25 },
    ];
    const { matrix } = transform({
      translate: true,
      rotate: true,
      scale: true,
    }).solve(base, from, to);
    expect(plane.round(matrix)).toEqual(
      plane.round(plane.multiply(plane.pinch(from, to), base.matrix)),
    );
  });

  it("keeps the centroid under the fingers with translate and scale", () => {
    const { matrix } = transform({ translate: true, scale: true }).solve(
      base,
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: 0, y: 10 },
        { x: 0, y: 30 },
      ],
    );
    const motion = plane.multiply(
      matrix,
      plane.invert(base.matrix) ?? plane.identity,
    );
    near(plane.apply(motion, { x: 5, y: 0 }), { x: 0, y: 20 });
    expect(Math.hypot(motion[0], motion[1])).toBeCloseTo(2, 9);
    expect(motion[1]).toBeCloseTo(0, 9);
  });

  it("keeps the pivot fixed and the determinant with rotate only", () => {
    const { matrix } = transform({ rotate: true }).solve(
      base,
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: 3, y: 4 },
        { x: 3, y: 34 },
      ],
    );
    const center = plane.apply(base.matrix, { x: 50, y: 30 });
    near(plane.apply(matrix, { x: 50, y: 30 }), center);
    const determinant = ([a, b, c, d]: readonly number[]) =>
      (a ?? 0) * (d ?? 0) - (b ?? 0) * (c ?? 0);
    expect(determinant(matrix)).toBeCloseTo(determinant(base.matrix), 9);
  });
});

describe("resize", () => {
  const sides: readonly Handle["x"][] = [-1, 0, 1];
  const handles: Handle[] = sides
    .flatMap((x) => sides.map((y) => ({ x, y })))
    .filter(({ x, y }) => x !== 0 || y !== 0);

  it("pins the opposite edge or corner for every handle on a rotated, skewed base", () => {
    for (const handle of handles) {
      const result = resize({ handle }).solve(
        base,
        [{ x: 0, y: 0 }],
        [{ x: 13, y: -7 }],
      );
      const anchor = (state: State) => ({
        x: ((1 - handle.x) / 2) * state.size.width,
        y: ((1 - handle.y) / 2) * state.size.height,
      });
      near(
        plane.apply(result.matrix, anchor(result)),
        plane.apply(base.matrix, anchor(base)),
      );
      if (handle.x === 0) expect(result.size.width).toBe(base.size.width);
      if (handle.y === 0) expect(result.size.height).toBe(base.size.height);
    }
  });

  it("grows symmetrically around the center", () => {
    const result = resize({ handle: { x: 1, y: 1 }, symmetric: true }).solve(
      { matrix: plane.translate(100, 100), size: { width: 40, height: 20 } },
      [{ x: 0, y: 0 }],
      [{ x: 5, y: 10 }],
    );
    expect(result.size).toEqual({ width: 50, height: 40 });
    expect(plane.round(result.matrix)).toEqual(plane.translate(95, 90));
  });

  it("never produces a negative size", () => {
    const result = resize({ handle: { x: 1, y: 0 } }).solve(
      { matrix: plane.identity, size: { width: 40, height: 20 } },
      [{ x: 0, y: 0 }],
      [{ x: -100, y: 0 }],
    );
    expect(result.size.width).toBe(0);
  });
});

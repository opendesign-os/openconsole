import { describe, expect, it } from "vitest";

import { closest } from "../capabilities";

const row = (top: number) => ({ left: 0, top, right: 100, bottom: top + 40 });

describe("closest", () => {
  it("picks the box whose center is nearest to the point", () => {
    const boxes = [row(0), row(50), row(100)];
    expect(closest({ x: 50, y: 10 }, boxes)).toBe(0);
    expect(closest({ x: 50, y: 74 }, boxes)).toBe(1);
    expect(closest({ x: 50, y: 400 }, boxes)).toBe(2);
  });

  it("reports -1 without boxes", () => {
    expect(closest({ x: 0, y: 0 }, [])).toBe(-1);
  });
});

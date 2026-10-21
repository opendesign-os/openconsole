import { describe, expect, it } from "vitest";

import { choose } from "../core";

const tree = new Map([
  ["board", ["panel", "slot"]],
  ["panel", ["slot"]],
]);

const contains = (outer: string, inner: string): boolean =>
  tree.get(outer)?.includes(inner) ?? false;

describe("choose", () => {
  it("prefers the innermost zone over its ancestors", () => {
    expect(
      choose(
        [
          { target: "slot", score: 1 },
          { target: "board", score: 9 },
          { target: "panel", score: 5 },
        ],
        contains,
      ),
    ).toBe("slot");
  });

  it("falls back to the higher score among unrelated zones", () => {
    expect(
      choose(
        [
          { target: "left", score: 1 },
          { target: "right", score: 3 },
        ],
        contains,
      ),
    ).toBe("right");
  });

  it("reports nothing without candidates", () => {
    expect(choose([], contains)).toBeUndefined();
  });
});

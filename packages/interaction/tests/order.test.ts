import { describe, expect, it } from "vitest";

import { arrange, closest } from "../core";

const row = (top: number) => ({ left: 0, top, right: 100, bottom: top + 40 });

function apply(items: readonly string[], current: number, target: number) {
  const { before, after } = arrange(current, target);
  const pick = (positions: readonly number[]) =>
    positions.map((position) => items[position] ?? "");
  const moving = new Set(pick([...before, ...after]));
  const rest = items.filter((value) => !moving.has(value));
  const at = rest.indexOf(items[current] ?? "");
  return [
    ...rest.slice(0, at),
    ...pick(before),
    ...rest.slice(at, at + 1),
    ...pick(after),
    ...rest.slice(at + 1),
  ];
}

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

describe("arrange", () => {
  it("moves the siblings in between before the item when it goes down", () => {
    expect(arrange(1, 3)).toEqual({ before: [2, 3], after: [] });
  });

  it("moves the siblings in between after the item when it goes up", () => {
    expect(arrange(3, 1)).toEqual({ before: [], after: [1, 2] });
  });

  it("moves nothing when the position does not change", () => {
    expect(arrange(2, 2)).toEqual({ before: [], after: [] });
  });

  it("lands the item at the target while only its siblings move", () => {
    const items = ["a", "b", "c", "d", "e"];
    expect(apply(items, 1, 3)).toEqual(["a", "c", "d", "b", "e"]);
    expect(apply(items, 3, 0)).toEqual(["d", "a", "b", "c", "e"]);
  });
});

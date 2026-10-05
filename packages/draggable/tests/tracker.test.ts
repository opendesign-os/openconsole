import { describe, expect, it } from "vitest";

import { plane, space } from "@openconsole/matrix";

import { Tracker, type Context, type Plugin } from "../core/tracker";
import { grid } from "../plugins/grid";

describe("Tracker", () => {
  it("starts idle with the given matrix", () => {
    expect(new Tracker().matrix).toEqual(space.identity);
    const tracker = new Tracker({ matrix: space.translate(5, 6, 0) });
    expect(tracker.matrix).toEqual(space.translate(5, 6, 0));
    expect(tracker.dragging).toBe(false);
  });

  it("translates by the pointer delta measured from the start point", () => {
    const tracker = new Tracker();
    tracker.start({ x: 10, y: 10 });
    expect(tracker.dragging).toBe(true);
    tracker.move({ x: 15, y: 30 });
    tracker.move({ x: 30, y: 25 });
    expect(space.round(tracker.matrix)).toEqual(space.translate(20, 15, 0));
    tracker.end({ x: 30, y: 25 });
    expect(tracker.dragging).toBe(false);
  });

  it("continues from the current matrix on the next drag", () => {
    const tracker = new Tracker();
    tracker.start({ x: 0, y: 0 });
    tracker.move({ x: 20, y: 0 });
    tracker.end({ x: 20, y: 0 });
    tracker.start({ x: 100, y: 100 });
    tracker.move({ x: 110, y: 105 });
    expect(space.round(tracker.matrix)).toEqual(space.translate(30, 5, 0));
  });

  it("keeps the element under the pointer inside a transformed frame", () => {
    const container = plane.multiply(
      plane.rotate(Math.PI / 6),
      plane.scale(1.5, 0.5),
    );
    const tracker = new Tracker({ matrix: space.lift(plane.rotate(0.3)) });
    const origin = tracker.matrix;
    tracker.start({ x: 100, y: 100 }, plane.invert(container));
    tracker.move({ x: 137, y: 81 });
    const shift = plane.apply(container, {
      x: tracker.matrix[12] - origin[12],
      y: tracker.matrix[13] - origin[13],
    });
    expect(shift.x).toBeCloseTo(37, 9);
    expect(shift.y).toBeCloseTo(-19, 9);
    expect(
      space.equals(space.linear(tracker.matrix), space.linear(origin)),
    ).toBe(true);
  });

  it("chains plugins in order and keeps the candidate when one returns nothing", () => {
    const seen: number[] = [];
    const spy: Plugin = {
      onMove: ({ matrix }) => {
        seen.push(matrix[12]);
      },
    };
    const tracker = new Tracker({ use: [grid(20), spy] });
    tracker.start({ x: 0, y: 0 });
    tracker.move({ x: 27, y: 4 });
    expect(seen).toEqual([20]);
    expect(space.round(tracker.matrix)).toEqual(space.translate(20, 0, 0));
  });

  it("hands plugins the origin, the frame, the candidate and the event", () => {
    const contexts: Context[] = [];
    const push = (context: Context) => {
      contexts.push(context);
    };
    const origin = space.translate(1, 2, 0);
    const tracker = new Tracker({
      matrix: origin,
      use: [{ onStart: push, onMove: push, onEnd: push }],
    });
    const frame = plane.scale(2);
    const down = { x: 0, y: 0 };
    const step = { x: 3, y: 4 };
    tracker.start(down, frame);
    tracker.move(step);
    tracker.end(step);

    const [start, move, end] = contexts;
    expect(contexts.map((context) => context.origin)).toEqual([
      origin,
      origin,
      origin,
    ]);
    expect(contexts.every((context) => context.frame === frame)).toBe(true);
    expect(start!.event).toBe(down);
    expect(start!.matrix).toBe(origin);
    expect(move!.event).toBe(step);
    expect(space.round(move!.matrix)).toEqual(space.translate(7, 10, 0));
    expect(end!.matrix).toBe(tracker.matrix);
  });

  it("passes custom input through to plugins", () => {
    interface Input {
      readonly x: number;
      readonly y: number;
      readonly shift: boolean;
    }
    const horizontal: Plugin<Input> = {
      onMove: ({ matrix, origin, event }) =>
        event.shift
          ? space.multiply(
              space.translate(0, origin[13] - matrix[13], 0),
              matrix,
            )
          : undefined,
    };
    const tracker = new Tracker<Input>({ use: [horizontal] });
    tracker.start({ x: 0, y: 0, shift: false });
    tracker.move({ x: 15, y: 40, shift: true });
    expect(space.round(tracker.matrix)).toEqual(space.translate(15, 0, 0));
    tracker.move({ x: 15, y: 40, shift: false });
    expect(space.round(tracker.matrix)).toEqual(space.translate(15, 40, 0));
  });

  it("attaches plugins with the current matrix and detaches them once on destroy", () => {
    const calls: string[] = [];
    const tracker = new Tracker({
      matrix: space.translate(7, 0, 0),
      use: [
        {
          onAttach: ({ matrix }) => {
            calls.push(`attach ${matrix[12]}`);
          },
          onDetach: () => {
            calls.push("detach");
          },
        },
      ],
    });
    tracker.destroy();
    tracker.destroy();
    expect(calls).toEqual(["attach 7", "detach"]);
  });

  it("swaps plugins at once when idle and keeps shared ones attached", () => {
    const calls: string[] = [];
    const named = (name: string): Plugin => ({
      onAttach: () => {
        calls.push(`attach ${name}`);
      },
      onDetach: () => {
        calls.push(`detach ${name}`);
      },
    });
    const shared = named("shared");
    const tracker = new Tracker({ use: [shared, named("old")] });
    tracker.update({ use: [shared, named("new")] });
    expect(calls).toEqual([
      "attach shared",
      "attach old",
      "detach old",
      "attach new",
    ]);
  });

  it("defers a plugin swap until the drag ends", () => {
    const calls: string[] = [];
    const old: Plugin = {
      onMove: () => {
        calls.push("old move");
      },
      onEnd: () => {
        calls.push("old end");
      },
      onDetach: () => {
        calls.push("old detach");
      },
    };
    const next: Plugin = {
      onAttach: ({ matrix }) => {
        calls.push(`next attach ${matrix[12]}`);
      },
    };
    const tracker = new Tracker({ use: [old] });
    tracker.start({ x: 0, y: 0 });
    tracker.update({ use: [next] });
    tracker.move({ x: 5, y: 0 });
    tracker.end({ x: 5, y: 0 });
    expect(calls).toEqual([
      "old move",
      "old end",
      "old detach",
      "next attach 5",
    ]);
  });

  it("drops an active drag on destroy without ending it", () => {
    const calls: string[] = [];
    const tracker = new Tracker({
      use: [
        {
          onEnd: () => {
            calls.push("end");
          },
          onDetach: () => {
            calls.push("detach");
          },
        },
      ],
    });
    tracker.start({ x: 0, y: 0 });
    tracker.destroy();
    expect(tracker.dragging).toBe(false);
    expect(calls).toEqual(["detach"]);
  });

  it("ignores `matrix` while dragging and applies it with a notice when idle", () => {
    const updates: number[] = [];
    const tracker = new Tracker({
      use: [
        {
          onUpdate: ({ matrix }) => {
            updates.push(matrix[12]);
          },
        },
      ],
    });
    tracker.start({ x: 0, y: 0 });
    tracker.update({ matrix: space.translate(99, 99, 0) });
    tracker.move({ x: 5, y: 5 });
    expect(space.round(tracker.matrix)).toEqual(space.translate(5, 5, 0));
    tracker.end({ x: 5, y: 5 });
    expect(updates).toEqual([]);
    tracker.update({ matrix: space.translate(99, 99, 0) });
    expect(tracker.matrix).toEqual(space.translate(99, 99, 0));
    expect(updates).toEqual([99]);
  });

  it("swaps plugins before announcing a matrix passed along with them", () => {
    const calls: string[] = [];
    const old: Plugin = {
      onUpdate: () => {
        calls.push("old update");
      },
      onDetach: () => {
        calls.push("old detach");
      },
    };
    const next: Plugin = {
      onAttach: ({ matrix }) => {
        calls.push(`next attach ${matrix[12]}`);
      },
      onUpdate: ({ matrix }) => {
        calls.push(`next update ${matrix[12]}`);
      },
    };
    const tracker = new Tracker({ use: [old] });
    tracker.update({ matrix: space.translate(8, 0, 0), use: [next] });
    expect(calls).toEqual(["old detach", "next attach 0", "next update 8"]);
  });

  it("ignores calls out of order", () => {
    const tracker = new Tracker();
    tracker.move({ x: 50, y: 50 });
    tracker.end({ x: 50, y: 50 });
    expect(tracker.matrix).toEqual(space.identity);
    expect(tracker.dragging).toBe(false);
    tracker.start({ x: 0, y: 0 });
    tracker.start({ x: 40, y: 40 });
    tracker.move({ x: 10, y: 0 });
    expect(space.round(tracker.matrix)).toEqual(space.translate(10, 0, 0));
  });
});

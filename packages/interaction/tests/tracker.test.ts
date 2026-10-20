import { describe, expect, it } from "vitest";

import { plane } from "@openconsole/matrix";

import { resize, Tracker, transform, type Context, type Plugin } from "../core";
import { grid, limits } from "../plugins";

const at = (x: number, y: number) => ({ points: [{ x, y }] });

describe("Tracker", () => {
  it("starts idle with the given matrix and size", () => {
    expect(new Tracker().state.matrix).toEqual(plane.identity);
    const tracker = new Tracker({
      matrix: plane.translate(5, 6),
      size: { width: 10, height: 20 },
    });
    expect(tracker.state).toEqual({
      matrix: plane.translate(5, 6),
      size: { width: 10, height: 20 },
    });
    expect(tracker.active).toBe(false);
  });

  it("translates by the pointer delta measured from the start point", () => {
    const tracker = new Tracker();
    tracker.start(at(10, 10));
    expect(tracker.active).toBe(true);
    tracker.move(at(15, 30));
    tracker.move(at(30, 25));
    expect(plane.round(tracker.state.matrix)).toEqual(plane.translate(20, 15));
    tracker.end(at(30, 25));
    expect(tracker.active).toBe(false);
  });

  it("continues from the current state on the next session", () => {
    const tracker = new Tracker();
    tracker.start(at(0, 0)).move(at(20, 0)).end(at(20, 0));
    tracker.start(at(100, 100)).move(at(110, 105));
    expect(plane.round(tracker.state.matrix)).toEqual(plane.translate(30, 5));
  });

  it("keeps the element under the pointer inside a transformed frame", () => {
    const container = plane.multiply(
      plane.rotate(Math.PI / 6),
      plane.scale(1.5, 0.5),
    );
    const tracker = new Tracker({ matrix: plane.rotate(0.3) });
    const origin = tracker.state.matrix;
    tracker.start(at(100, 100), plane.invert(container));
    tracker.move(at(137, 81));
    const { matrix } = tracker.state;
    const shift = plane.apply(container, {
      x: matrix[4] - origin[4],
      y: matrix[5] - origin[5],
    });
    expect(shift.x).toBeCloseTo(37, 9);
    expect(shift.y).toBeCloseTo(-19, 9);
    expect(plane.equals(plane.linear(matrix), plane.linear(origin))).toBe(true);
  });

  it("chains plugins in order and keeps the candidate when one returns nothing", () => {
    const seen: number[] = [];
    const spy: Plugin = {
      onMove: ({ state }) => {
        seen.push(state.matrix[4]);
      },
    };
    const tracker = new Tracker({ plugins: [grid(20), spy] });
    tracker.start(at(0, 0)).move(at(27, 4));
    expect(seen).toEqual([20]);
    expect(plane.round(tracker.state.matrix)).toEqual(plane.translate(20, 0));
  });

  it("hands plugins the origin, the previous state, the frame, the anchor and the input", () => {
    const contexts: Context[] = [];
    const push = (context: Context) => {
      contexts.push(context);
    };
    const origin = plane.translate(1, 2);
    const tracker = new Tracker({
      matrix: origin,
      plugins: [{ onStart: push, onMove: push, onEnd: push }],
    });
    const frame = plane.scale(2);
    const down = at(0, 0);
    const step = at(3, 4);
    tracker.start(down, frame).move(step).end(step);

    const [start, move, end] = contexts;
    expect(contexts.map((context) => context.origin.matrix)).toEqual([
      origin,
      origin,
      origin,
    ]);
    expect(contexts.every((context) => context.frame === frame)).toBe(true);
    expect(start!.input).toBe(down);
    expect(start!.state.matrix).toBe(origin);
    expect(move!.input).toBe(step);
    expect(move!.previous.matrix).toBe(origin);
    expect(move!.anchor).toEqual({ x: 6, y: 8 });
    expect(plane.round(move!.state.matrix)).toEqual(plane.translate(7, 10));
    expect(end!.state).toBe(tracker.state);
  });

  it("passes the input modifiers through to plugins", () => {
    const keys = (shift: boolean) => ({
      shift,
      alt: false,
      control: false,
      meta: false,
    });
    const horizontal: Plugin = {
      onMove: ({ state, origin, input }) => {
        if (!input.modifiers?.shift) return undefined;
        const [a, b, c, d, e] = state.matrix;
        return { ...state, matrix: [a, b, c, d, e, origin.matrix[5]] };
      },
    };
    const tracker = new Tracker({ plugins: [horizontal] });
    tracker.start(at(0, 0));
    tracker.move({ points: [{ x: 15, y: 40 }], modifiers: keys(true) });
    expect(plane.round(tracker.state.matrix)).toEqual(plane.translate(15, 0));
    tracker.move({ points: [{ x: 15, y: 40 }], modifiers: keys(false) });
    expect(plane.round(tracker.state.matrix)).toEqual(plane.translate(15, 40));
  });

  it("re-anchors when the number of points changes without jumping", () => {
    const tracker = new Tracker({
      action: transform({ translate: true, rotate: true, scale: true }),
    });
    tracker.start(at(0, 0)).move(at(10, 0));
    const before = tracker.state.matrix;
    tracker.move({
      points: [
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ],
    });
    expect(plane.equals(tracker.state.matrix, before)).toBe(true);
    tracker.move({
      points: [
        { x: 10, y: 0 },
        { x: 30, y: 0 },
      ],
    });
    expect(plane.round(tracker.state.matrix)).toEqual(
      plane.round(
        plane.multiply(plane.around({ x: 10, y: 0 }, plane.scale(2)), before),
      ),
    );
    const pinched = tracker.state.matrix;
    tracker.move(at(10, 0));
    expect(plane.equals(tracker.state.matrix, pinched)).toBe(true);
  });

  it("keeps the container-space anchor when the frame changes mid-session", () => {
    const tracker = new Tracker();
    tracker.start(at(10, 10));
    tracker.move(at(20, 10), plane.translate(5, 0));
    expect(plane.round(tracker.state.matrix)).toEqual(plane.translate(15, 0));
  });

  it("nudges in container, local and screen space", () => {
    const frame = plane.scale(0.5);
    const tracker = new Tracker({ matrix: plane.rotate(Math.PI / 2) });
    tracker.start({ points: [] }, frame);
    tracker.nudge({ matrix: plane.translate(10, 0), space: "container" });
    expect(plane.round(tracker.state.matrix)).toEqual(
      plane.round(
        plane.multiply(plane.translate(10, 0), plane.rotate(Math.PI / 2)),
      ),
    );
    tracker.nudge({ matrix: plane.translate(10, 0), space: "local" });
    expect(plane.round(tracker.state.matrix)).toEqual(
      plane.round(
        plane.multiply(plane.translate(10, 10), plane.rotate(Math.PI / 2)),
      ),
    );
    tracker.nudge({ matrix: plane.translate(10, 0), space: "screen" });
    expect(plane.round(tracker.state.matrix)).toEqual(
      plane.round(
        plane.multiply(plane.translate(15, 10), plane.rotate(Math.PI / 2)),
      ),
    );
  });

  it("re-pins a resize after a plugin clamps the size", () => {
    const tracker = new Tracker({
      matrix: plane.translate(100, 0),
      size: { width: 100, height: 50 },
      action: resize({ handle: { x: -1, y: 0 } }),
      plugins: [limits({ width: { max: 120 } })],
    });
    tracker.start(at(100, 0)).move(at(40, 0));
    expect(tracker.state.size.width).toBe(120);
    expect(plane.apply(tracker.state.matrix, { x: 120, y: 0 })).toEqual({
      x: 200,
      y: 0,
    });
  });

  it("notifies onChange once per commit, including cancel", () => {
    const changes: number[] = [];
    const tracker = new Tracker({
      plugins: [
        {
          onChange: ({ state }) => {
            changes.push(state.matrix[4]);
          },
        },
      ],
    });
    tracker.start(at(0, 0)).move(at(5, 0));
    tracker.nudge({ matrix: plane.translate(1, 0), space: "container" });
    tracker.cancel();
    tracker.update({ matrix: plane.translate(9, 0) });
    expect(changes).toEqual([5, 6, 0, 9]);
  });

  it("cancels back to the origin and calls onCancel instead of onEnd", () => {
    const calls: string[] = [];
    const tracker = new Tracker({
      matrix: plane.translate(3, 0),
      plugins: [
        {
          onEnd: () => {
            calls.push("end");
          },
          onCancel: ({ state }) => {
            calls.push(`cancel ${state.matrix[4]}`);
          },
        },
      ],
    });
    tracker.start(at(0, 0)).move(at(50, 0)).cancel();
    expect(calls).toEqual(["cancel 3"]);
    expect(tracker.state.matrix).toEqual(plane.translate(3, 0));
    expect(tracker.active).toBe(false);
  });

  it("attaches plugins with the current state and detaches them once on destroy", () => {
    const calls: string[] = [];
    const tracker = new Tracker({
      matrix: plane.translate(7, 0),
      plugins: [
        {
          onAttach: ({ state }) => {
            calls.push(`attach ${state.matrix[4]}`);
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
    const tracker = new Tracker({ plugins: [shared, named("old")] });
    tracker.update({ plugins: [shared, named("new")] });
    expect(calls).toEqual([
      "attach shared",
      "attach old",
      "detach old",
      "attach new",
    ]);
  });

  it("defers a plugin swap until the session ends", () => {
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
      onAttach: ({ state }) => {
        calls.push(`next attach ${state.matrix[4]}`);
      },
    };
    const tracker = new Tracker({ plugins: [old] });
    tracker.start(at(0, 0));
    tracker.update({ plugins: [next] });
    tracker.move(at(5, 0)).end(at(5, 0));
    expect(calls).toEqual([
      "old move",
      "old end",
      "old detach",
      "next attach 5",
    ]);
  });

  it("appends plugins with `use`, one or many at a time, each only once", () => {
    const calls: string[] = [];
    const named = (name: string): Plugin => ({
      onAttach: () => {
        calls.push(`attach ${name}`);
      },
      onMove: () => {
        calls.push(`move ${name}`);
      },
    });
    const first = named("first");
    new Tracker()
      .use(first)
      .use([named("second"), first, named("third")])
      .start(at(0, 0))
      .move(at(1, 0));
    expect(calls).toEqual([
      "attach first",
      "attach second",
      "attach third",
      "move first",
      "move second",
      "move third",
    ]);
  });

  it("appends to a pending swap when `use` is called during a session", () => {
    const calls: string[] = [];
    const named = (name: string): Plugin => ({
      onAttach: () => {
        calls.push(`attach ${name}`);
      },
      onDetach: () => {
        calls.push(`detach ${name}`);
      },
    });
    const tracker = new Tracker({ plugins: [named("old")] })
      .start(at(0, 0))
      .update({ plugins: [named("next")] })
      .use(named("extra"));
    expect(calls).toEqual(["attach old"]);
    tracker.end(at(0, 0));
    expect(calls).toEqual([
      "attach old",
      "detach old",
      "attach next",
      "attach extra",
    ]);
  });

  it("cancels an active session on destroy", () => {
    const calls: string[] = [];
    const tracker = new Tracker({
      plugins: [
        {
          onEnd: () => {
            calls.push("end");
          },
          onCancel: () => {
            calls.push("cancel");
          },
          onDetach: () => {
            calls.push("detach");
          },
        },
      ],
    });
    tracker.start(at(0, 0)).move(at(9, 0));
    tracker.destroy();
    expect(tracker.active).toBe(false);
    expect(tracker.state.matrix).toEqual(plane.identity);
    expect(calls).toEqual(["cancel", "detach"]);
  });

  it("ignores state updates while active and applies them when idle", () => {
    const tracker = new Tracker();
    tracker.start(at(0, 0));
    tracker.update({ matrix: plane.translate(99, 99) });
    tracker.move(at(5, 5));
    expect(plane.round(tracker.state.matrix)).toEqual(plane.translate(5, 5));
    tracker.end(at(5, 5));
    tracker.update({ matrix: plane.translate(99, 99), index: 3 });
    expect(tracker.state.matrix).toEqual(plane.translate(99, 99));
    expect(tracker.state.index).toBe(3);
  });

  it("swaps plugins before announcing a state passed along with them", () => {
    const calls: string[] = [];
    const old: Plugin = {
      onChange: () => {
        calls.push("old change");
      },
      onDetach: () => {
        calls.push("old detach");
      },
    };
    const next: Plugin = {
      onAttach: ({ state }) => {
        calls.push(`next attach ${state.matrix[4]}`);
      },
      onChange: ({ state }) => {
        calls.push(`next change ${state.matrix[4]}`);
      },
    };
    const tracker = new Tracker({ plugins: [old] });
    tracker.update({ matrix: plane.translate(8, 0), plugins: [next] });
    expect(calls).toEqual(["old detach", "next attach 0", "next change 8"]);
  });

  it("ignores calls out of order", () => {
    const tracker = new Tracker();
    tracker.move(at(50, 50));
    tracker.nudge({ matrix: plane.translate(1, 1), space: "container" });
    tracker.end(at(50, 50));
    tracker.cancel();
    expect(tracker.state.matrix).toEqual(plane.identity);
    expect(tracker.active).toBe(false);
    tracker.start(at(0, 0));
    tracker.start(at(40, 40));
    tracker.move(at(10, 0));
    expect(plane.round(tracker.state.matrix)).toEqual(plane.translate(10, 0));
  });
});

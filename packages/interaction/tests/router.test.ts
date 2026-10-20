import { describe, expect, it } from "vitest";

import { allows, pick, type Marker, type Target } from "../dom";

const target = (): Target => ({
  limit: () => 1,
  activation: () => ({}),
  start: () => true,
  move: () => undefined,
  end: () => undefined,
  cancel: () => undefined,
});

function setup() {
  const markers = new Map<EventTarget, Marker[]>();
  const mark = (
    element: EventTarget,
    owner: Target,
    kind: Marker["kind"],
    priority = 0,
  ) => {
    markers.set(element, [
      ...(markers.get(element) ?? []),
      { target: owner, kind, priority },
    ]);
  };
  return { mark, find: (element: EventTarget) => markers.get(element) };
}

describe("pick", () => {
  it("routes to the innermost handle", () => {
    const { mark, find } = setup();
    const [inner, outer] = [new EventTarget(), new EventTarget()];
    const [card, board] = [target(), target()];
    mark(inner, card, "handle");
    mark(outer, board, "handle");
    expect(pick([inner, outer], find)).toEqual({ handle: inner, target: card });
    expect(pick([outer], find)).toEqual({ handle: outer, target: board });
    expect(pick([new EventTarget()], find)).toBeUndefined();
  });

  it("lets an ignored press fall through to an outer binding", () => {
    const { mark, find } = setup();
    const [chart, card, viewport] = [
      new EventTarget(),
      new EventTarget(),
      new EventTarget(),
    ];
    const [drag, pan] = [target(), target()];
    mark(card, drag, "handle");
    mark(chart, drag, "ignore");
    mark(viewport, pan, "handle");
    expect(pick([card, viewport], find)?.target).toBe(drag);
    expect(pick([chart, card, viewport], find)).toEqual({
      handle: viewport,
      target: pan,
    });
  });

  it("tries bindings on the same element by priority", () => {
    const { mark, find } = setup();
    const [zone, edge] = [new EventTarget(), new EventTarget()];
    const [resize, drag] = [target(), target()];
    mark(edge, drag, "handle", 0);
    mark(edge, resize, "handle", 10);
    expect(pick([edge], find)?.target).toBe(resize);
    mark(zone, resize, "ignore", 20);
    expect(pick([zone, edge], find)?.target).toBe(drag);
  });
});

describe("allows", () => {
  it("lets the innermost marker decide at equal priority", () => {
    const { mark, find } = setup();
    const [grip, area, card] = [
      new EventTarget(),
      new EventTarget(),
      new EventTarget(),
    ];
    const owner = target();
    mark(card, owner, "handle");
    mark(area, owner, "ignore");
    mark(grip, owner, "handle");
    expect(allows([card], owner, find)).toBe(true);
    expect(allows([area, card], owner, find)).toBe(false);
    expect(allows([grip, area, card], owner, find)).toBe(true);
  });

  it("lets a higher priority override the nesting", () => {
    const { mark, find } = setup();
    const [grip, area] = [new EventTarget(), new EventTarget()];
    const owner = target();
    mark(grip, owner, "handle", 0);
    mark(area, owner, "ignore", 1);
    expect(allows([grip, area], owner, find)).toBe(false);
  });

  it("only reads the markers of the given binding", () => {
    const { mark, find } = setup();
    const element = new EventTarget();
    const [owner, other] = [target(), target()];
    mark(element, other, "handle");
    expect(allows([element], owner, find)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { plane } from "@openconsole/matrix";

import { Store, Tracker, type State } from "../core";

const initial: State = {
  matrix: plane.identity,
  size: { width: 10, height: 10 },
};

describe("Store", () => {
  it("syncs a tracker as it joins", () => {
    const store = new Store({ ...initial, matrix: plane.translate(4, 0) });
    const tracker = new Tracker();
    store.join(tracker);
    expect(tracker.state).toEqual(store.state);
  });

  it("syncs every tracker except the source and notifies the listener", () => {
    const seen: State[] = [];
    const store = new Store(initial, (state) => seen.push(state));
    const [source, other] = [new Tracker(), new Tracker()];
    store.join(source);
    store.join(other);
    const next = { ...initial, matrix: plane.translate(7, 0) };
    expect(store.commit(next, source)).toBe(true);
    expect(other.state.matrix).toEqual(next.matrix);
    expect(source.state).toEqual(initial);
    expect(seen).toEqual([store.state]);
    expect(store.commit({})).toBe(false);
  });

  it("lets one tracker hold the session at a time", () => {
    const store = new Store(initial);
    const [first, second] = [new Tracker(), new Tracker()];
    expect(store.lock(first)).toBe(true);
    expect(store.lock(second)).toBe(false);
    expect(store.free(first)).toBe(true);
    store.leave(first);
    expect(store.lock(second)).toBe(true);
  });
});

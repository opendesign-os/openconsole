import { describe, expect, it } from "vitest";

import { plane } from "@openconsole/matrix";

import { Tracker } from "../core";
import { Store, type Patch, type State } from "../model";

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
    const seen: [State, Patch][] = [];
    const store = new Store(initial, (state, patch) =>
      seen.push([state, patch]),
    );
    const [source, other] = [new Tracker(), new Tracker()];
    store.join(source);
    store.join(other);
    const next = { ...initial, matrix: plane.translate(7, 0) };
    expect(store.commit(next, source)).toBe(true);
    expect(other.state.matrix).toEqual(next.matrix);
    expect(source.state).toEqual(initial);
    expect(seen).toEqual([[store.state, next]]);
    expect(store.commit({})).toBe(false);
  });

  it("lets one tracker hold the session at a time", () => {
    const store = new Store(initial);
    const [first, second] = [new Tracker(), new Tracker()];
    expect(store.lock(first)).toBe(true);
    expect(store.lock(first)).toBe(true);
    expect(store.lock(second)).toBe(false);
    store.leave(first);
    expect(store.lock(second)).toBe(true);
  });

  it("assigns only while no session holds the lock", () => {
    const store = new Store(initial);
    const tracker = new Tracker();
    const size = { width: 20, height: 20 };
    store.lock(tracker);
    expect(store.assign({ size })).toBe(false);
    store.unlock(tracker);
    expect(store.assign({ size })).toBe(true);
    expect(store.state.size).toEqual(size);
  });
});

import { merge, type Patch, type State } from "./state";
import type { Tracker } from "./tracker";

export class Store {
  #state: State;
  #owner: Tracker | undefined;
  readonly #trackers = new Set<Tracker>();
  readonly #listen: (state: State) => void;

  constructor(state: State, listen: (state: State) => void = () => undefined) {
    this.#state = state;
    this.#listen = listen;
  }

  get state(): State {
    return this.#state;
  }

  join(tracker: Tracker): void {
    this.#trackers.add(tracker);
    tracker.update(this.#state);
  }

  leave(tracker: Tracker): void {
    this.#trackers.delete(tracker);
    this.unlock(tracker);
  }

  lock(tracker: Tracker): boolean {
    if (!this.free(tracker)) return false;
    this.#owner = tracker;
    return true;
  }

  unlock(tracker: Tracker): void {
    if (this.#owner === tracker) this.#owner = undefined;
  }

  free(tracker: Tracker): boolean {
    return this.#owner === undefined || this.#owner === tracker;
  }

  commit(patch: Patch, source?: Tracker): boolean {
    const state = merge(this.#state, patch);
    if (state === this.#state) return false;
    this.#state = state;
    for (const tracker of this.#trackers) {
      if (tracker !== source) tracker.update(state);
    }
    this.#listen(state);
    return true;
  }
}

import { merge, type Patch, type State } from "./state";

export interface Member {
  assign(patch: Patch): void;
}

export class Store {
  #state: State;
  #holder: Member | undefined;
  readonly #members = new Set<Member>();
  readonly #listener: (state: State, patch: Patch) => void;

  constructor(
    state: State,
    listener: (state: State, patch: Patch) => void = () => undefined,
  ) {
    this.#state = state;
    this.#listener = listener;
  }

  get state(): State {
    return this.#state;
  }

  get locked(): boolean {
    return this.#holder !== undefined;
  }

  join(member: Member): void {
    this.#members.add(member);
    member.assign(this.#state);
  }

  leave(member: Member): void {
    this.#members.delete(member);
    this.unlock(member);
  }

  lock(member: Member): boolean {
    if (this.#holder && this.#holder !== member) return false;
    this.#holder = member;
    return true;
  }

  unlock(member: Member): void {
    if (this.#holder === member) this.#holder = undefined;
  }

  commit(patch: Patch, source?: Member): boolean {
    const state = merge(this.#state, patch);
    if (state === this.#state) return false;
    this.#state = state;
    for (const member of this.#members) {
      if (member !== source) member.assign(state);
    }
    this.#listener(state, patch);
    return true;
  }

  assign(patch: Patch): boolean {
    return !this.locked && this.commit(patch);
  }
}

import { merge, type Patch, type State } from "./state";

export interface Member {
  assign(patch: Patch): void;
}

export class Store {
  #state: State;
  #owner: Member | undefined;
  readonly #members = new Set<Member>();
  readonly #listen: (state: State, patch: Patch) => void;

  constructor(
    state: State,
    listen: (state: State, patch: Patch) => void = () => undefined,
  ) {
    this.#state = state;
    this.#listen = listen;
  }

  get state(): State {
    return this.#state;
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
    if (this.#owner && this.#owner !== member) return false;
    this.#owner = member;
    return true;
  }

  unlock(member: Member): void {
    if (this.#owner === member) this.#owner = undefined;
  }

  commit(patch: Patch, source?: Member): boolean {
    const state = merge(this.#state, patch);
    if (state === this.#state) return false;
    this.#state = state;
    for (const member of this.#members) {
      if (member !== source) member.assign(state);
    }
    this.#listen(state, patch);
    return true;
  }

  assign(patch: Patch): boolean {
    return this.#owner === undefined && this.commit(patch);
  }
}

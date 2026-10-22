import { merge, type Patch, type State } from "./state";

export interface Member {
  assign(patch: Patch): void;
}

export class Store {
  #state: State;
  #active: Member | undefined;
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

  get locked(): boolean {
    return this.#active !== undefined;
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
    if (this.#active && this.#active !== member) return false;
    this.#active = member;
    return true;
  }

  unlock(member: Member): void {
    if (this.#active === member) this.#active = undefined;
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
    return !this.locked && this.commit(patch);
  }
}

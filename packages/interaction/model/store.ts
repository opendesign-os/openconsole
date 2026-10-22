/**
 * @file 共享状态：同一节点上的多项能力共用一份状态，同一时间只有一个会话写入。
 */

import { merge, type Patch, type State } from "./state";

/** 状态的订阅者，通常是一个 `Tracker`；有新状态时经 `assign` 收到。 */
export interface Member {
  /**
   * 收到存储里的最新状态。
   *
   * @param patch 最新状态；完整状态也是合法的局部写入。
   */
  assign(patch: Patch): void;
}

/**
 * 一个节点的共享状态：登记成员、会话锁、提交并同步。
 *
 * 会话开始时用 `lock` 独占、结束时 `unlock`；会话中的写入用 `commit`，会话之外的程序写入用
 * `assign`，有会话时 `assign` 不生效，避免打断进行中的拖拽。
 *
 * @example
 * const store = new Store(initial, (state) => render(state));
 * store.join(tracker);
 * if (store.lock(tracker)) {
 *   store.commit(next, tracker);
 *   store.unlock(tracker);
 * }
 */
export class Store {
  #state: State;
  /** 持有会话锁的成员；没有会话时为 `undefined`。 */
  #holder: Member | undefined;
  readonly #members = new Set<Member>();
  /** 每次提交后调用；DOM 侧的 `View` 用它渲染。 */
  readonly #listener: (state: State, patch: Patch) => void;

  /**
   * @param state 初始状态。
   * @param listener 每次提交后调用，收到新状态与本次写入。
   */
  constructor(
    state: State,
    listener: (state: State, patch: Patch) => void = () => undefined,
  ) {
    this.#state = state;
    this.#listener = listener;
  }

  /** 当前状态。 */
  get state(): State {
    return this.#state;
  }

  /** 是否有成员持有会话锁。 */
  get locked(): boolean {
    return this.#holder !== undefined;
  }

  /**
   * 登记成员，并立即把当前状态同步给它。
   *
   * @param member 成员。
   */
  join(member: Member): void {
    this.#members.add(member);
    member.assign(this.#state);
  }

  /**
   * 注销成员；它持有的会话锁一并释放。
   *
   * @param member 成员。
   */
  leave(member: Member): void {
    this.#members.delete(member);
    this.unlock(member);
  }

  /**
   * 为会话加锁。
   *
   * @param member 开始会话的成员。
   * @returns 加锁成功或本来就由它持有时为 `true`；被别的成员持有时为 `false`。
   */
  lock(member: Member): boolean {
    if (this.#holder && this.#holder !== member) return false;
    this.#holder = member;
    return true;
  }

  /**
   * 释放会话锁；不是持有者时不做任何事。
   *
   * @param member 结束会话的成员。
   */
  unlock(member: Member): void {
    if (this.#holder === member) this.#holder = undefined;
  }

  /**
   * 写入并同步给其他成员，然后通知监听者；不受会话锁限制。
   *
   * @param patch 局部写入。
   * @param source 写入来源；它已持有该状态，不再回传给它。
   * @returns `patch` 含有字段时为 `true`；空写入为 `false`，也不会通知。
   */
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

  /**
   * 会话之外的程序写入；有会话时不生效。
   *
   * @param patch 局部写入。
   * @returns 是否写入。
   */
  assign(patch: Patch): boolean {
    return !this.locked && this.commit(patch);
  }
}

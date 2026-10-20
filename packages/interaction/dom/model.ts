import { plane, space, type Matrix, type Point } from "@openconsole/matrix";

import {
  fold,
  frame,
  merge,
  type Patch,
  type Size,
  type State,
  type Tracker,
} from "../core";
import {
  computed,
  linear,
  offset,
  rect,
  rendered,
  size,
  write,
} from "./measure";

export type Render = (node: HTMLElement, state: State) => void;

const models = new WeakMap<HTMLElement, Model>();

const same = (left: Size, right: Size): boolean =>
  Math.abs(left.width - right.width) < 1e-6 &&
  Math.abs(left.height - right.height) < 1e-6;

export class Model {
  readonly node: HTMLElement;
  #state: State;
  #offset: Point<2> = { x: 0, y: 0 };
  #layout: Size;
  #ready = false;
  #placed = false;
  #sized = false;
  #owner: Tracker | undefined;
  #render: Render | undefined;
  readonly #trackers = new Set<Tracker>();

  private constructor(node: HTMLElement) {
    this.node = node;
    this.#layout = size(node);
    this.#state = { matrix: plane.identity, size: this.#layout };
    this.prepare();
  }

  static of(node: HTMLElement): Model {
    const existing = models.get(node);
    if (existing) return existing;
    const model = new Model(node);
    models.set(node, model);
    return model;
  }

  get state(): State {
    return this.#state;
  }

  join(tracker: Tracker, render?: Render): void {
    this.#trackers.add(tracker);
    if (render) this.#render = render;
    tracker.update(this.#state);
  }

  leave(tracker: Tracker): void {
    this.#trackers.delete(tracker);
    this.unlock(tracker);
    if (this.#trackers.size === 0) models.delete(this.node);
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

  prepare(): void {
    const { node } = this;
    if (!rendered(node)) return;
    const position = offset(node);
    const measured = size(node);
    if (!this.#ready) {
      this.#ready = true;
      this.#offset = position;
      this.#layout = measured;
      const matrix = plane.multiply(
        plane.translate(position.x, position.y),
        fold(computed(node), measured) ?? plane.identity,
      );
      const { style } = node;
      style.transformOrigin = "0 0";
      style.transformBox = "border-box";
      style.translate = "none";
      style.rotate = "none";
      style.scale = "none";
      this.#state = merge(this.#state, {
        matrix: this.#placed ? undefined : matrix,
        size: this.#sized ? undefined : measured,
      });
      this.#paint();
      this.#sync();
      return;
    }
    const shifted =
      position.x !== this.#offset.x || position.y !== this.#offset.y;
    const resized = !same(measured, this.#layout);
    if (!shifted && !resized) return;
    this.#layout = measured;
    this.#state = {
      ...this.#state,
      size: measured,
      matrix: plane.multiply(
        plane.translate(
          position.x - this.#offset.x,
          position.y - this.#offset.y,
        ),
        this.#state.matrix,
      ),
    };
    this.#offset = position;
    this.#sync();
  }

  relayout(): void {
    this.#offset = offset(this.node);
    this.#paint();
  }

  frame(): Matrix<2, "affine"> | undefined {
    return frame(linear(this.node), rect(this.node), this.#state);
  }

  assign(patch: Patch): void {
    const state = merge(this.#state, patch);
    if (state === this.#state) return;
    if (!this.#ready) {
      this.#placed ||= Boolean(patch.matrix);
      this.#sized ||= Boolean(patch.size);
    }
    this.#state = state;
    if (this.#ready) this.#paint();
    this.#sync();
  }

  commit(state: State, source: Tracker): void {
    this.#state = state;
    this.#paint();
    this.#sync(source);
  }

  #sync(source?: Tracker): void {
    for (const tracker of this.#trackers) {
      if (tracker !== source) tracker.update(this.#state);
    }
  }

  #paint(): void {
    if (this.#render) {
      this.#render(this.node, this.#state);
      return;
    }
    const { node } = this;
    if (!same(this.#state.size, this.#layout)) {
      write(node, this.#state.size);
      this.#layout = this.#state.size;
      this.#offset = offset(node);
    }
    node.style.transform = space.format(
      space.lift(
        plane.multiply(
          plane.translate(-this.#offset.x, -this.#offset.y),
          this.#state.matrix,
        ),
      ),
    );
  }
}

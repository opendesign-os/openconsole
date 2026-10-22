import { plane, space, type Matrix, type Point } from "@openconsole/matrix";

import { convert, frame } from "../core";
import {
  extent,
  Store,
  type Bounds,
  type Patch,
  type Size,
  type State,
} from "../model";
import {
  client,
  computed,
  linear,
  offset,
  rect,
  rendered,
  size,
  write,
} from "./measure";
import { fold } from "./style";

export type Render = (node: HTMLElement, state: State) => void;

const views = new WeakMap<HTMLElement, View>();

const same = (left: Size, right: Size): boolean =>
  Math.abs(left.width - right.width) < 1e-6 &&
  Math.abs(left.height - right.height) < 1e-6;

export class View {
  readonly node: HTMLElement;
  readonly store: Store;
  render: Render | undefined;
  #offset: Point<2> = { x: 0, y: 0 };
  #layout: Size;
  #ready = false;
  #placed = false;
  #sized = false;

  private constructor(node: HTMLElement) {
    this.node = node;
    this.#layout = size(node);
    this.store = new Store(
      { matrix: plane.identity, size: this.#layout },
      (state, patch) => this.#change(state, patch),
    );
    this.prepare();
  }

  static of(node: HTMLElement): View {
    const existing = views.get(node);
    if (existing) return existing;
    const view = new View(node);
    views.set(node, view);
    return view;
  }

  prepare(): void {
    const { node, store } = this;
    if (!rendered(node)) return;
    const position = offset(node);
    const measured = size(node);
    if (!this.#ready) {
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
      this.#ready = true;
      this.#offset = position;
      this.#layout = measured;
      const changed = store.commit({
        matrix: this.#placed ? undefined : matrix,
        size: this.#sized ? undefined : measured,
      });
      if (!changed) this.#paint(store.state);
      return;
    }
    if (
      position.x === this.#offset.x &&
      position.y === this.#offset.y &&
      same(measured, this.#layout)
    ) {
      return;
    }
    const shift = plane.translate(
      position.x - this.#offset.x,
      position.y - this.#offset.y,
    );
    this.#offset = position;
    this.#layout = measured;
    store.commit({
      size: measured,
      matrix: plane.multiply(shift, store.state.matrix),
    });
  }

  relayout(): void {
    this.#offset = offset(this.node);
    this.#paint(this.store.state);
  }

  frame(): Matrix<2, "affine"> | undefined {
    return frame(linear(this.node), rect(this.node), this.store.state);
  }

  #change(state: State, patch: Patch): void {
    if (!this.#ready) {
      this.#placed ||= Boolean(patch.matrix);
      this.#sized ||= Boolean(patch.size);
    }
    this.#paint(state);
  }

  #paint(state: State): void {
    const { node, render } = this;
    if (render) {
      render(node, state);
      return;
    }
    if (!this.#ready) return;
    if (!same(state.size, this.#layout)) {
      write(node, state.size);
      this.#layout = state.size;
      this.#offset = offset(node);
    }
    const matrix = plane.multiply(
      plane.translate(-this.#offset.x, -this.#offset.y),
      state.matrix,
    );
    node.style.transform = plane.equals(matrix, plane.identity)
      ? "none"
      : space.format(space.lift(matrix));
  }
}

export function transfer(node: HTMLElement, container: HTMLElement): boolean {
  const view = View.of(node);
  if (node.parentElement === container || view.store.locked) return false;
  view.prepare();
  const before = view.frame();
  const { matrix, size } = view.store.state;
  container.append(node);
  view.prepare();
  const after = view.frame();
  const next = before && after && convert(matrix, before, after);
  if (next) view.store.assign({ matrix: next, size });
  return true;
}

export const region =
  (container: HTMLElement, node: HTMLElement) => (): Bounds => {
    const whole = {
      left: 0,
      top: 0,
      right: container.clientWidth,
      bottom: container.clientHeight,
    };
    if (node.offsetParent === container) return whole;
    const frame = View.of(node).frame();
    const polygon = client(container);
    if (!frame || !polygon) return whole;
    return extent(polygon.map((point) => plane.apply(frame, point)));
  };

export function reset(node: HTMLElement): void {
  const view = View.of(node);
  view.relayout();
  view.store.assign({
    matrix: plane.translate(node.offsetLeft, node.offsetTop),
  });
}

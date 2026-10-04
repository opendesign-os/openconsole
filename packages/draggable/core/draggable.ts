import { plane, space, type Matrix, type Point } from "@openconsole/matrix";

import { frame } from "./frame";
import { bind } from "./pointer";

export interface Context {
  readonly matrix: Matrix<3, "projective">;
  readonly origin: Matrix<3, "projective">;
  readonly node: HTMLElement;
  readonly event: PointerEvent;
}

export interface Plugin {
  onStart?(context: Context): void;
  onMove?(context: Context): Matrix<3, "projective"> | void;
  onEnd?(context: Context): void;
}

export interface Options {
  matrix?: Matrix<3, "projective">;
  use?: readonly Plugin[];
}

export class Draggable {
  readonly node: HTMLElement;
  #matrix: Matrix<3, "projective">;
  #plugins: readonly Plugin[];
  #active: readonly Plugin[] = [];
  #origin: Matrix<3, "projective"> = space.identity;
  #frame: Matrix<2, "affine"> = plane.identity;
  #anchor: Point<2> = { x: 0, y: 0 };
  #hint = "";
  #dragging = false;
  readonly #touch: string;
  readonly #release: () => void;

  constructor(node: HTMLElement, options: Options = {}) {
    this.node = node;
    this.#matrix =
      options.matrix ?? space.parse(getComputedStyle(node).transform);
    this.#plugins = options.use ?? [];
    this.#touch = node.style.touchAction;
    node.style.touchAction = "none";
    if (options.matrix) this.#render();
    this.#release = bind(node, {
      start: (event) => this.#start(event),
      move: (event) => this.#move(event),
      end: (event) => this.#end(event),
    });
  }

  get matrix(): Matrix<3, "projective"> {
    return this.#matrix;
  }

  get dragging(): boolean {
    return this.#dragging;
  }

  update(options: Options): void {
    if (options.use) this.#plugins = options.use;
    if (options.matrix && !this.#dragging) {
      this.#matrix = options.matrix;
      this.#render();
    }
  }

  destroy(): void {
    this.#release();
    this.node.style.touchAction = this.#touch;
  }

  [Symbol.dispose](): void {
    this.destroy();
  }

  #context(matrix: Matrix<3, "projective">, event: PointerEvent): Context {
    return { matrix, origin: this.#origin, node: this.node, event };
  }

  #start(event: PointerEvent): void {
    this.#dragging = true;
    this.#active = this.#plugins;
    this.#origin = this.#matrix;
    this.#frame = frame(this.node);
    this.#anchor = { x: event.clientX, y: event.clientY };
    this.#hint = this.node.style.willChange;
    this.node.style.willChange = "transform";
    const context = this.#context(this.#matrix, event);
    for (const plugin of this.#active) plugin.onStart?.(context);
  }

  #move(event: PointerEvent): void {
    const delta = plane.apply(this.#frame, {
      x: event.clientX - this.#anchor.x,
      y: event.clientY - this.#anchor.y,
    });
    let matrix = space.multiply(
      space.translate(delta.x, delta.y, 0),
      this.#origin,
    );
    for (const plugin of this.#active) {
      const next = plugin.onMove?.(this.#context(matrix, event));
      if (next) matrix = next;
    }
    this.#matrix = matrix;
    this.#render();
  }

  #end(event: PointerEvent): void {
    this.#dragging = false;
    this.node.style.willChange = this.#hint;
    const context = this.#context(this.#matrix, event);
    for (const plugin of this.#active) plugin.onEnd?.(context);
  }

  #render(): void {
    this.node.style.transform = space.format(this.#matrix);
  }
}

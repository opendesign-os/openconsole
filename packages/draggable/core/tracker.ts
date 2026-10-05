import { plane, space, type Matrix, type Point } from "@openconsole/matrix";

export interface Context<E extends Point<2> = Point<2>> {
  readonly matrix: Matrix<3, "projective">;
  readonly origin: Matrix<3, "projective">;
  readonly frame: Matrix<2, "affine">;
  readonly event: E;
}

export interface Plugin<E extends Point<2> = Point<2>> {
  onAttach?(context: Pick<Context<E>, "matrix">): void;
  onStart?(context: Context<E>): void;
  onMove?(context: Context<E>): Matrix<3, "projective"> | void;
  onEnd?(context: Context<E>): void;
  onUpdate?(context: Pick<Context<E>, "matrix">): void;
  onDetach?(): void;
}

export interface Options<E extends Point<2> = Point<2>> {
  matrix?: Matrix<3, "projective">;
  use?: readonly Plugin<E>[];
}

interface Session {
  readonly origin: Matrix<3, "projective">;
  readonly frame: Matrix<2, "affine">;
  readonly anchor: Point<2>;
}

export class Tracker<E extends Point<2> = Point<2>> {
  #matrix: Matrix<3, "projective">;
  #plugins: readonly Plugin<E>[] = [];
  #pending: readonly Plugin<E>[] | undefined;
  #session: Session | undefined;

  constructor(options: Options<E> = {}) {
    this.#matrix = options.matrix ?? space.identity;
    this.#use(options.use ?? []);
  }

  get matrix(): Matrix<3, "projective"> {
    return this.#matrix;
  }

  get dragging(): boolean {
    return this.#session !== undefined;
  }

  update(options: Options<E>): void {
    if (options.use) {
      if (this.#session) this.#pending = options.use;
      else this.#use(options.use);
    }
    if (!options.matrix || this.#session) return;
    this.#matrix = options.matrix;
    const context = { matrix: options.matrix };
    for (const plugin of this.#plugins) plugin.onUpdate?.(context);
  }

  start(event: E, frame: Matrix<2, "affine"> = plane.identity): void {
    if (this.#session) return;
    const origin = this.#matrix;
    this.#session = { origin, frame, anchor: { x: event.x, y: event.y } };
    const context = { matrix: origin, origin, frame, event };
    for (const plugin of this.#plugins) plugin.onStart?.(context);
  }

  move(event: E): void {
    if (!this.#session) return;
    const { origin, frame, anchor } = this.#session;
    const delta = plane.apply(frame, {
      x: event.x - anchor.x,
      y: event.y - anchor.y,
    });
    let matrix = space.multiply(space.translate(delta.x, delta.y, 0), origin);
    for (const plugin of this.#plugins) {
      const next = plugin.onMove?.({ matrix, origin, frame, event });
      if (next) matrix = next;
    }
    this.#matrix = matrix;
  }

  end(event: E): void {
    if (!this.#session) return;
    const { origin, frame } = this.#session;
    this.#session = undefined;
    const context = { matrix: this.#matrix, origin, frame, event };
    for (const plugin of this.#plugins) plugin.onEnd?.(context);
    if (!this.#pending) return;
    this.#use(this.#pending);
    this.#pending = undefined;
  }

  destroy(): void {
    this.#session = undefined;
    this.#pending = undefined;
    this.#use([]);
  }

  #use(plugins: readonly Plugin<E>[]): void {
    const previous = this.#plugins;
    this.#plugins = plugins;
    for (const plugin of previous) {
      if (!plugins.includes(plugin)) plugin.onDetach?.();
    }
    for (const plugin of plugins) {
      if (!previous.includes(plugin)) {
        plugin.onAttach?.({ matrix: this.#matrix });
      }
    }
  }
}

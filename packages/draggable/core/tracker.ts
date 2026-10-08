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
  plugins?: readonly Plugin<E>[];
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
    this.#swap(options.plugins ?? []);
  }

  get matrix(): Matrix<3, "projective"> {
    return this.#matrix;
  }

  get dragging(): boolean {
    return this.#session !== undefined;
  }

  use(plugins: Plugin<E> | readonly Plugin<E>[]): this {
    const current = this.#pending ?? this.#plugins;
    return this.update({ plugins: [...new Set(current.concat(plugins))] });
  }

  update(options: Options<E>): this {
    const { matrix, plugins } = options;
    if (plugins) {
      if (this.#session) this.#pending = plugins;
      else this.#swap(plugins);
    }
    if (matrix && !this.#session) {
      this.#matrix = matrix;
      for (const plugin of this.#plugins) plugin.onUpdate?.({ matrix });
    }
    return this;
  }

  start(event: E, frame: Matrix<2, "affine"> = plane.identity): this {
    if (this.#session) return this;
    const origin = this.#matrix;
    this.#session = { origin, frame, anchor: { x: event.x, y: event.y } };
    const context = { matrix: origin, origin, frame, event };
    for (const plugin of this.#plugins) plugin.onStart?.(context);
    return this;
  }

  move(event: E): this {
    if (!this.#session) return this;
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
    return this;
  }

  end(event: E): this {
    if (!this.#session) return this;
    const { origin, frame } = this.#session;
    this.#session = undefined;
    const context = { matrix: this.#matrix, origin, frame, event };
    for (const plugin of this.#plugins) plugin.onEnd?.(context);
    if (this.#pending) this.#swap(this.#pending);
    this.#pending = undefined;
    return this;
  }

  destroy(): this {
    this.#session = undefined;
    this.#pending = undefined;
    this.#swap([]);
    return this;
  }

  #swap(plugins: readonly Plugin<E>[]): void {
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

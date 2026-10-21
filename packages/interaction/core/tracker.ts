import { plane, type Matrix, type Point } from "@openconsole/matrix";

import { merge, type Patch, type State } from "../model";
import { anchor, pin, resizes, transform, type Action } from "./action";

export interface Modifiers {
  readonly shift: boolean;
  readonly alt: boolean;
  readonly control: boolean;
  readonly meta: boolean;
}

export interface Input {
  readonly points: readonly Point<2>[];
  readonly modifiers?: Modifiers;
  readonly event?: unknown;
  readonly timestamp?: number;
}

export interface Step {
  readonly matrix: Matrix<2, "affine">;
  readonly space: "screen" | "container" | "local";
}

export interface Context {
  readonly state: State;
  readonly origin: State;
  readonly previous: State;
  readonly frame: Matrix<2, "affine">;
  readonly anchor: Point<2>;
  readonly action: Action;
  readonly input: Input;
}

export interface Plugin {
  onAttach?(context: Pick<Context, "state">): void;
  onStart?(context: Context): void;
  onMove?(context: Context): State | void;
  onEnd?(context: Context): void;
  onCancel?(context: Context): void;
  onChange?(context: Pick<Context, "state">): void;
  onDetach?(): void;
}

export interface TrackerOptions {
  readonly action?: Action | undefined;
  readonly plugins?: readonly Plugin[] | undefined;
}

interface Session {
  readonly action: Action;
  readonly origin: State;
  frame: Matrix<2, "affine">;
  base: State;
  from: readonly Point<2>[];
  points: readonly Point<2>[];
  raw: State;
  previous: State;
  input: Input;
}

const initial: State = {
  matrix: plane.identity,
  size: { width: 0, height: 0 },
};

const convert = (
  frame: Matrix<2, "affine">,
  points: readonly Point<2>[],
): readonly Point<2>[] => points.map((point) => plane.apply(frame, point));

function apply(
  step: Step,
  frame: Matrix<2, "affine">,
  matrix: Matrix<2, "affine">,
): Matrix<2, "affine"> | undefined {
  if (step.space === "local") return plane.multiply(matrix, step.matrix);
  if (step.space === "container") return plane.multiply(step.matrix, matrix);
  const inverse = plane.invert(frame);
  return inverse && plane.multiply(frame, step.matrix, inverse, matrix);
}

export class Tracker {
  #state = initial;
  #action: Action;
  #plugins: readonly Plugin[] = [];
  #pending: readonly Plugin[] | undefined;
  #session: Session | undefined;

  constructor(options: TrackerOptions = {}) {
    this.#action = options.action ?? transform({ translate: true });
    this.#swap(options.plugins ?? []);
  }

  get state(): State {
    return this.#state;
  }

  get action(): Action {
    return this.#action;
  }

  get active(): boolean {
    return this.#session !== undefined;
  }

  update({ action, plugins }: TrackerOptions): this {
    if (plugins) {
      if (this.#session) this.#pending = plugins;
      else this.#swap(plugins);
    }
    if (action) this.#action = action;
    return this;
  }

  assign(patch: Patch): this {
    const state = merge(this.#state, patch);
    if (state !== this.#state && !this.#session) this.#change(state);
    return this;
  }

  start(input: Input, frame: Matrix<2, "affine"> = plane.identity): this {
    if (this.#session) return this;
    const state = this.#state;
    const points = convert(frame, input.points);
    const session: Session = {
      action: this.#action,
      origin: state,
      frame,
      base: state,
      from: points,
      points,
      raw: state,
      previous: state,
      input,
    };
    this.#session = session;
    const context = this.#context(session, state);
    for (const plugin of this.#plugins) plugin.onStart?.(context);
    return this;
  }

  move(input: Input, frame?: Matrix<2, "affine">): this {
    const session = this.#session;
    if (!session) return this;
    if (frame) session.frame = frame;
    const points = convert(session.frame, input.points);
    if (points.length !== session.from.length) {
      session.base = session.raw;
      session.from = points;
    }
    session.points = points;
    session.input = input;
    session.raw = session.action.solve(session.base, session.from, points);
    this.#commit(session);
    return this;
  }

  nudge(step: Step): this {
    const session = this.#session;
    if (!session) return this;
    const matrix = apply(step, session.frame, session.raw.matrix);
    if (!matrix) return this;
    session.raw = { ...session.raw, matrix };
    session.base = session.raw;
    session.from = session.points;
    this.#commit(session);
    return this;
  }

  end(input?: Input): this {
    const session = this.#session;
    if (!session) return this;
    if (input) session.input = input;
    this.#session = undefined;
    const context = this.#context(session, this.#state);
    for (const plugin of this.#plugins) plugin.onEnd?.(context);
    this.#flush();
    return this;
  }

  cancel(): this {
    const session = this.#session;
    if (!session) return this;
    this.#session = undefined;
    const context = this.#context(session, session.origin);
    for (const plugin of this.#plugins) plugin.onCancel?.(context);
    this.#change(session.origin);
    this.#flush();
    return this;
  }

  destroy(): this {
    this.cancel();
    this.#pending = undefined;
    this.#swap([]);
    return this;
  }

  #context(session: Session, state: State): Context {
    return {
      state,
      origin: session.origin,
      previous: session.previous,
      frame: session.frame,
      anchor: anchor(session.action.freedom, session.base, session.points),
      action: session.action,
      input: session.input,
    };
  }

  #commit(session: Session): void {
    const context = this.#context(session, session.raw);
    let state = session.raw;
    for (const plugin of this.#plugins) {
      const next = plugin.onMove?.({ ...context, state });
      if (next) state = next;
    }
    const { freedom } = session.action;
    if (resizes(freedom)) {
      state = {
        ...state,
        matrix: pin(session.base, state.size, freedom.edges),
      };
    }
    session.previous = state;
    this.#change(state);
  }

  #change(state: State): void {
    this.#state = state;
    for (const plugin of this.#plugins) plugin.onChange?.({ state });
  }

  #flush(): void {
    if (this.#pending) this.#swap(this.#pending);
    this.#pending = undefined;
  }

  #swap(plugins: readonly Plugin[]): void {
    const previous = this.#plugins;
    this.#plugins = plugins;
    for (const plugin of previous) {
      if (!plugins.includes(plugin)) plugin.onDetach?.();
    }
    for (const plugin of plugins) {
      if (!previous.includes(plugin)) plugin.onAttach?.({ state: this.#state });
    }
  }
}

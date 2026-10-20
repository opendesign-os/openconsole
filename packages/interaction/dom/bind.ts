import type { Matrix } from "@openconsole/matrix";

import {
  Tracker,
  type Action,
  type Context,
  type Input,
  type Patch,
  type Plugin,
  type State,
  type Step,
} from "../core";
import { listen, type Grab, type Keys } from "./keyboard";
import { Model, type Render } from "./model";
import {
  forget,
  register,
  type Activation,
  type Marker,
  type Target,
} from "./router";

export interface Session {
  readonly node: HTMLElement;
  readonly state: State;
  readonly frame: Matrix<2, "affine">;
  readonly action: Action;
  readonly input: Input;
  readonly data: unknown;
}

export interface Observer {
  onStart?(session: Session): void;
  onMove?(session: Session): void;
  onEnd?(session: Session): void;
  onCancel?(session: Session): void;
}

export interface BindOptions extends Patch {
  readonly action: Action;
  readonly handle?: Element | readonly Element[];
  readonly ignore?: Element | readonly Element[];
  readonly plugins?: readonly Plugin[];
  readonly activation?: Activation | ((type: string) => Activation);
  readonly priority?: number;
  readonly render?: Render;
  readonly keys?: Keys;
  readonly data?: unknown;
  readonly signal?: AbortSignal;
  readonly onStart?: (context: Context) => void;
  readonly onMove?: (context: Context) => void;
  readonly onEnd?: (context: Context) => void;
  readonly onCancel?: (context: Context) => void;
}

interface Update extends Patch {
  readonly action?: Action | undefined;
  readonly plugins?: readonly Plugin[] | undefined;
}

const observers = new Set<Observer>();

export function observe(observer: Observer): () => void {
  observers.add(observer);
  return () => {
    observers.delete(observer);
  };
}

const list = (value: Element | readonly Element[] | undefined) =>
  value instanceof Element ? [value] : (value ?? []);

function listener(options: BindOptions): Plugin {
  const { onStart, onMove, onEnd, onCancel } = options;
  return {
    ...(onStart ? { onStart } : {}),
    ...(onMove ? { onMove } : {}),
    ...(onEnd ? { onEnd } : {}),
    ...(onCancel ? { onCancel } : {}),
  };
}

export class Binding {
  readonly node: HTMLElement;
  readonly #model: Model;
  readonly #tracker: Tracker;
  readonly #listener: Plugin;
  readonly #target: Target;
  readonly #grab: Grab | undefined;
  readonly #priority: number;
  readonly #handles = new Map<Element, () => void>();
  readonly #ignores = new Map<Element, () => void>();
  readonly #data: unknown;
  #implicit: (() => void) | undefined;
  #alive = true;
  #plugins: readonly Plugin[];
  #frame: Matrix<2, "affine"> | undefined;
  #last: Input = { points: [] };
  #watch: AbortController | undefined;

  constructor(node: HTMLElement, options: BindOptions) {
    const { activation = {}, priority = 0, keys } = options;
    this.node = node;
    this.#data = options.data;
    this.#priority = priority;
    this.#listener = listener(options);
    this.#plugins = options.plugins ?? [];
    this.#model = Model.of(node);
    this.#tracker = new Tracker({
      action: options.action,
      plugins: [...this.#plugins, this.#listener],
    });
    this.#model.join(this.#tracker, options.render);
    this.#model.assign(options);
    this.#target = {
      limit: () => {
        const { freedom } = this.#tracker.action;
        return freedom.rotate || freedom.scale ? 2 : 1;
      },
      activation: (type) =>
        typeof activation === "function" ? activation(type) : activation,
      start: (input) => this.start(input),
      move: (input) => this.move(input),
      end: (input) => this.end(input),
      cancel: () => this.cancel(),
    };
    this.#grab = keys && {
      keys,
      state: () => this.#tracker.state,
      start: (input) => this.start(input),
      nudge: (step) => this.nudge(step),
      end: (input) => this.end(input),
      cancel: () => this.cancel(),
    };
    for (const element of list(options.handle)) this.handle(element);
    if (this.#handles.size === 0) {
      this.#implicit = this.#mark(node, "handle", priority);
    }
    for (const element of list(options.ignore)) this.ignore(element);
    const { signal } = options;
    if (signal?.aborted) this.destroy();
    else
      signal?.addEventListener("abort", () => this.destroy(), { once: true });
  }

  get state(): State {
    return this.#tracker.state;
  }

  get active(): boolean {
    return this.#tracker.active;
  }

  start(input: Input): boolean {
    if (this.#tracker.active || !this.#model.lock(this.#tracker)) return false;
    this.#model.prepare();
    const frame = this.#model.frame();
    if (!frame) {
      this.#model.unlock(this.#tracker);
      return false;
    }
    this.#frame = frame;
    this.#last = input;
    this.#watch = new AbortController();
    this.node.ownerDocument.addEventListener("scroll", () => this.refresh(), {
      capture: true,
      passive: true,
      signal: this.#watch.signal,
    });
    this.#tracker.start(input, frame);
    this.#notify("onStart");
    return true;
  }

  move(input: Input): this {
    if (!this.#tracker.active) return this;
    this.#last = input;
    this.#tracker.move(input);
    this.#model.commit(this.#tracker.state, this.#tracker);
    this.#notify("onMove");
    return this;
  }

  nudge(step: Step): this {
    if (!this.#tracker.active) return this;
    this.#tracker.nudge(step);
    this.#model.commit(this.#tracker.state, this.#tracker);
    this.#notify("onMove");
    return this;
  }

  end(input?: Input): this {
    if (!this.#tracker.active) return this;
    if (input && input.points.length > 0) this.#last = input;
    this.#tracker.end(input);
    this.#finish();
    this.#notify("onEnd");
    return this;
  }

  cancel(): this {
    if (!this.#tracker.active) return this;
    this.#tracker.cancel();
    this.#model.commit(this.#tracker.state, this.#tracker);
    this.#finish();
    this.#notify("onCancel");
    return this;
  }

  refresh(): this {
    if (!this.#tracker.active) {
      this.#model.prepare();
      return this;
    }
    const frame = this.#model.frame();
    if (!frame) return this;
    this.#frame = frame;
    this.#tracker.move(this.#last, frame);
    this.#model.commit(this.#tracker.state, this.#tracker);
    this.#notify("onMove");
    return this;
  }

  relayout(): this {
    this.#model.relayout();
    return this;
  }

  use(plugins: Plugin | readonly Plugin[]): this {
    return this.update({
      plugins: [...new Set(this.#plugins.concat(plugins))],
    });
  }

  update(options: Update): this {
    const { action, plugins } = options;
    if (plugins) this.#plugins = plugins;
    this.#tracker.update({
      action,
      plugins: plugins && [...plugins, this.#listener],
    });
    if (!this.#tracker.active && this.#model.free(this.#tracker)) {
      this.#model.assign(options);
    }
    return this;
  }

  handle(element: Element, options: { readonly priority?: number } = {}) {
    this.#handles.get(element)?.();
    this.#implicit?.();
    this.#implicit = undefined;
    const release = this.#mark(
      element,
      "handle",
      options.priority ?? this.#priority,
    );
    this.#handles.set(element, release);
    return (): void => {
      if (this.#handles.get(element) !== release) return;
      this.#handles.delete(element);
      release();
      if (this.#handles.size === 0 && this.#alive) {
        this.#implicit = this.#mark(this.node, "handle", this.#priority);
      }
    };
  }

  ignore(element: Element, options: { readonly priority?: number } = {}) {
    this.#ignores.get(element)?.();
    const release = this.#mark(
      element,
      "ignore",
      options.priority ?? this.#priority,
    );
    this.#ignores.set(element, release);
    return (): void => {
      if (this.#ignores.get(element) !== release) return;
      this.#ignores.delete(element);
      release();
    };
  }

  destroy(): this {
    if (!this.#alive) return this;
    this.#alive = false;
    this.cancel();
    forget(this.#target);
    this.#implicit?.();
    this.#implicit = undefined;
    for (const release of this.#handles.values()) release();
    for (const release of this.#ignores.values()) release();
    this.#handles.clear();
    this.#ignores.clear();
    this.#model.leave(this.#tracker);
    this.#tracker.destroy();
    return this;
  }

  [Symbol.dispose](): void {
    this.destroy();
  }

  #mark(element: Element, kind: Marker["kind"], priority: number): () => void {
    const releases = [
      register(element, { target: this.#target, kind, priority }),
    ];
    if (kind === "handle" && this.#grab) {
      releases.push(listen(element, this.#grab));
    }
    return () => {
      for (const release of releases) release();
    };
  }

  #finish(): void {
    this.#model.unlock(this.#tracker);
    this.#watch?.abort();
    this.#watch = undefined;
  }

  #notify(name: keyof Observer): void {
    const frame = this.#frame;
    if (observers.size === 0 || !frame) return;
    const session: Session = {
      node: this.node,
      state: this.#tracker.state,
      frame,
      action: this.#tracker.action,
      input: this.#last,
      data: this.#data,
    };
    for (const observer of [...observers]) observer[name]?.(session);
  }
}

export const bind = (node: HTMLElement, options: BindOptions): Binding =>
  new Binding(node, options);

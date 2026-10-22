import type { Matrix } from "@openconsole/matrix";

import {
  Tracker,
  type Action,
  type Context,
  type Input,
  type Plugin,
  type Step,
  type TrackerOptions,
} from "../core";
import type { Patch, State } from "../model";
import { listen, type Grab, type Keys } from "./keyboard";
import { hold } from "./motion";
import {
  forget,
  register,
  type Activation,
  type Marker,
  type Target,
} from "./router";
import { View, type Render } from "./view";

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

export type Elements = Element | readonly Element[] | string;

export interface BindOptions {
  readonly action: Action;
  readonly handle?: Elements;
  readonly ignore?: Elements;
  readonly plugins?: readonly Plugin[];
  readonly activation?: Activation | ((type: string) => Activation);
  readonly priority?: number;
  readonly render?: Render;
  readonly keys?: Keys;
  readonly data?: unknown;
  readonly onStart?: (context: Context) => void;
  readonly onMove?: (context: Context) => void;
  readonly onEnd?: (context: Context) => void;
  readonly onCancel?: (context: Context) => void;
}

const observers = new Set<Observer>();

export function observe(observer: Observer): () => void {
  observers.add(observer);
  return () => {
    observers.delete(observer);
  };
}

function list(
  node: HTMLElement,
  value: Elements | undefined,
): readonly Element[] {
  if (typeof value === "string") return [...node.querySelectorAll(value)];
  return value instanceof Element ? [value] : (value ?? []);
}

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
  readonly #view: View;
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
  #frame: Matrix<2, "affine"> | undefined;
  #last: Input = { points: [] };
  #watch: AbortController | undefined;

  constructor(node: HTMLElement, options: BindOptions) {
    const { activation = {}, priority = 0, keys } = options;
    this.node = node;
    this.#data = options.data;
    this.#priority = priority;
    this.#listener = listener(options);
    this.#view = View.of(node);
    this.#tracker = new Tracker({
      action: options.action,
      plugins: [...(options.plugins ?? []), this.#listener],
    });
    if (options.render) this.#view.render = options.render;
    this.#view.store.join(this.#tracker);
    const control = {
      start: (input: Input) => this.start(input),
      end: (input: Input) => this.end(input),
      cancel: () => this.cancel(),
    };
    this.#target = {
      ...control,
      move: (input) => this.move(input),
      limit: () => {
        const { freedom } = this.#tracker.action;
        return freedom.rotate || freedom.scale ? 2 : 1;
      },
      activation: (type) =>
        typeof activation === "function" ? activation(type) : activation,
    };
    this.#grab = keys && {
      ...control,
      nudge: (step) => this.nudge(step),
      keys,
      state: () => this.#tracker.state,
    };
    for (const element of list(node, options.handle)) this.handle(element);
    for (const element of list(node, options.ignore)) this.ignore(element);
    this.#sync();
  }

  get state(): State {
    return this.#tracker.state;
  }

  get active(): boolean {
    return this.#tracker.active;
  }

  start(input: Input): boolean {
    const { store } = this.#view;
    if (this.#tracker.active || !store.lock(this.#tracker)) return false;
    hold(this.node);
    this.#view.prepare();
    const frame = this.#view.frame();
    if (!frame) {
      store.unlock(this.#tracker);
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
    this.#commit();
    this.#notify("onMove");
    return this;
  }

  nudge(step: Step): this {
    if (!this.#tracker.active) return this;
    this.#tracker.nudge(step);
    this.#commit();
    this.#notify("onMove");
    return this;
  }

  end(input?: Input): this {
    if (!this.#tracker.active) return this;
    if (input && input.points.length > 0) this.#last = input;
    this.#finish();
    this.#tracker.end(input);
    this.#notify("onEnd");
    return this;
  }

  cancel(): this {
    if (!this.#tracker.active) return this;
    this.#finish();
    this.#tracker.cancel();
    this.#commit();
    this.#notify("onCancel");
    return this;
  }

  refresh(): this {
    if (!this.#tracker.active) {
      this.#view.prepare();
      return this;
    }
    const frame = this.#view.frame();
    if (!frame) return this;
    this.#frame = frame;
    this.#tracker.move(this.#last, frame);
    this.#commit();
    this.#notify("onMove");
    return this;
  }

  update({ action, plugins }: TrackerOptions): this {
    this.#tracker.update({
      action,
      plugins: plugins && [...plugins, this.#listener],
    });
    return this;
  }

  assign(patch: Patch): this {
    this.#view.store.assign(patch);
    return this;
  }

  handle(element: Element, { priority = this.#priority } = {}): () => void {
    return this.#add(this.#handles, element, "handle", priority);
  }

  ignore(element: Element, { priority = this.#priority } = {}): () => void {
    return this.#add(this.#ignores, element, "ignore", priority);
  }

  destroy(): void {
    if (!this.#alive) return;
    this.#alive = false;
    this.cancel();
    forget(this.#target);
    for (const release of this.#handles.values()) release();
    for (const release of this.#ignores.values()) release();
    this.#handles.clear();
    this.#ignores.clear();
    this.#sync();
    this.#view.store.leave(this.#tracker);
    this.#tracker.destroy();
  }

  [Symbol.dispose](): void {
    this.destroy();
  }

  #add(
    marks: Map<Element, () => void>,
    element: Element,
    kind: Marker["kind"],
    priority: number,
  ): () => void {
    marks.get(element)?.();
    const release = this.#mark(element, kind, priority);
    marks.set(element, release);
    this.#sync();
    return () => {
      if (marks.get(element) !== release) return;
      marks.delete(element);
      release();
      this.#sync();
    };
  }

  #sync(): void {
    const implicit = this.#alive && this.#handles.size === 0;
    if (implicit && !this.#implicit) {
      this.#implicit = this.#mark(this.node, "handle", this.#priority);
    } else if (!implicit && this.#implicit) {
      this.#implicit();
      this.#implicit = undefined;
    }
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

  #commit(): void {
    this.#view.store.commit(this.#tracker.state, this.#tracker);
  }

  #finish(): void {
    this.#view.store.unlock(this.#tracker);
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

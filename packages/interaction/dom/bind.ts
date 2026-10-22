import type { Matrix } from "@openconsole/matrix";

import {
  Tracker,
  type Action,
  type Context,
  type Input,
  type Plugin,
  type Step,
} from "../core";
import type { Patch, State } from "../model";
import { hold } from "./flip";
import { keyboard } from "./keyboard";
import { pointer } from "./pointer";
import type { Activation, Control, Keys, Mark, Sensor } from "./sensor";
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
  readonly sensors?: readonly Sensor[];
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

interface Entry {
  readonly mark: Mark;
  release: () => void;
}

const observers = new Set<Observer>();

const defaults: readonly Sensor[] = [pointer(), keyboard()];

export function observe(observer: Observer): () => void {
  observers.add(observer);
  return () => {
    observers.delete(observer);
  };
}

const keyed = ({ keys = {} }: BindOptions): boolean =>
  Object.keys(keys).length > 0;

function resolve(
  node: HTMLElement,
  value: Elements | undefined,
): readonly Element[] {
  if (typeof value === "string") return [...node.querySelectorAll(value)];
  return value instanceof Element ? [value] : (value ?? []);
}

function callbacks(options: BindOptions): Plugin {
  const { onStart, onMove, onEnd, onCancel } = options;
  return {
    ...(onStart ? { onStart } : {}),
    ...(onMove ? { onMove } : {}),
    ...(onEnd ? { onEnd } : {}),
    ...(onCancel ? { onCancel } : {}),
  };
}

export class Binding implements Control {
  readonly node: HTMLElement;
  readonly #view: View;
  readonly #tracker: Tracker;
  readonly #handles = new Map<Element, Entry>();
  readonly #ignores = new Map<Element, Entry>();
  #options: BindOptions;
  #callbacks: Plugin;
  #fallback: Entry | undefined;
  #declared: (() => void)[] = [];
  #alive = true;
  #frame: Matrix<2, "affine"> | undefined;
  #input: Input = { points: [] };
  #scroll: AbortController | undefined;
  #request: number | undefined;

  constructor(node: HTMLElement, options: BindOptions) {
    this.node = node;
    this.#options = options;
    this.#callbacks = callbacks(options);
    this.#view = View.of(node);
    this.#tracker = new Tracker({
      action: options.action,
      plugins: [...(options.plugins ?? []), this.#callbacks],
    });
    if (options.render) this.#view.render = options.render;
    this.#view.store.join(this.#tracker);
    this.#mount();
    this.#sync();
  }

  get options(): BindOptions {
    return this.#options;
  }

  get state(): State {
    return this.#tracker.state;
  }

  get action(): Action {
    return this.#tracker.action;
  }

  get keys(): Keys {
    return this.#options.keys ?? {};
  }

  get active(): boolean {
    return this.#tracker.active;
  }

  activation(type: string): Activation {
    const { activation = {} } = this.#options;
    return typeof activation === "function" ? activation(type) : activation;
  }

  start(input: Input): boolean {
    const tracker = this.#tracker;
    if (tracker.released) this.#close();
    const { store } = this.#view;
    if (tracker.active || !store.lock(tracker)) return false;
    hold(this.node);
    this.#view.prepare();
    const frame = this.#view.frame();
    if (!frame) {
      store.unlock(tracker);
      return false;
    }
    this.#frame = frame;
    this.#input = input;
    this.#scroll = new AbortController();
    this.node.ownerDocument.addEventListener("scroll", () => this.refresh(), {
      capture: true,
      passive: true,
      signal: this.#scroll.signal,
    });
    tracker.start(input, frame);
    this.#notify("onStart");
    return true;
  }

  move(input: Input): this {
    if (!this.#tracker.active || this.#tracker.released) return this;
    this.#input = input;
    this.#tracker.move(input);
    this.#commit();
    this.#notify("onMove");
    this.#animate();
    return this;
  }

  nudge(step: Step): this {
    if (!this.#tracker.active || this.#tracker.released) return this;
    this.#tracker.nudge(step);
    this.#commit();
    this.#notify("onMove");
    this.#animate();
    return this;
  }

  end(input?: Input): this {
    const tracker = this.#tracker;
    if (!tracker.active || tracker.released) return this;
    if (input && input.points.length > 0) this.#input = input;
    tracker.release(input);
    this.#commit();
    this.#notify("onMove");
    if (tracker.animating) this.#animate();
    else this.#close();
    return this;
  }

  cancel(): this {
    if (!this.#tracker.active) return this;
    this.#halt();
    this.#unlock();
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
    this.#tracker.move(this.#input, frame);
    this.#commit();
    this.#notify("onMove");
    this.#animate();
    return this;
  }

  update(options: Partial<BindOptions>): this {
    const previous = this.#options;
    this.#options = { ...previous, ...options };
    const changed = (...keys: (keyof BindOptions)[]) =>
      keys.some((key) => key in options && options[key] !== previous[key]);
    if (changed("render")) this.#view.render = this.#options.render;
    if (
      changed("action", "plugins", "onStart", "onMove", "onEnd", "onCancel")
    ) {
      this.#callbacks = callbacks(this.#options);
      this.#tracker.update({
        action: this.#options.action,
        plugins: [...(this.#options.plugins ?? []), this.#callbacks],
      });
    }
    if (
      changed("sensors", "activation") ||
      keyed(previous) !== keyed(this.#options)
    ) {
      this.#reattach();
    }
    if (changed("handle", "ignore", "priority")) {
      this.#fallback?.release();
      this.#fallback = undefined;
      this.#mount();
      this.#sync();
    }
    return this;
  }

  assign(patch: Patch): this {
    this.#view.store.assign(patch);
    return this;
  }

  handle(element: Element, { priority = this.#priority } = {}): () => void {
    return this.#add(this.#handles, { element, kind: "handle", priority });
  }

  ignore(element: Element, { priority = this.#priority } = {}): () => void {
    return this.#add(this.#ignores, { element, kind: "ignore", priority });
  }

  destroy(): void {
    if (!this.#alive) return;
    this.#alive = false;
    if (this.#tracker.released) this.#close();
    else this.cancel();
    for (const entry of [
      ...this.#handles.values(),
      ...this.#ignores.values(),
    ]) {
      entry.release();
    }
    this.#handles.clear();
    this.#ignores.clear();
    this.#declared = [];
    this.#sync();
    this.#view.store.leave(this.#tracker);
    this.#tracker.destroy();
  }

  [Symbol.dispose](): void {
    this.destroy();
  }

  get #priority(): number {
    return this.#options.priority ?? 0;
  }

  #mount(): void {
    for (const release of this.#declared) release();
    const { handle, ignore } = this.#options;
    this.#declared = [
      ...resolve(this.node, handle).map((element) => this.handle(element)),
      ...resolve(this.node, ignore).map((element) => this.ignore(element)),
    ];
  }

  #add(entries: Map<Element, Entry>, mark: Mark): () => void {
    entries.get(mark.element)?.release();
    const entry: Entry = { mark, release: this.#attach(mark) };
    entries.set(mark.element, entry);
    this.#sync();
    return () => {
      if (entries.get(mark.element) !== entry) return;
      entries.delete(mark.element);
      entry.release();
      this.#sync();
    };
  }

  #attach(mark: Mark): () => void {
    const { sensors = defaults } = this.#options;
    const releases = sensors.flatMap((sensor) => sensor(this, mark) ?? []);
    return () => {
      for (const release of releases) release();
    };
  }

  #reattach(): void {
    const entries = [...this.#handles.values(), ...this.#ignores.values()];
    for (const entry of this.#fallback
      ? [...entries, this.#fallback]
      : entries) {
      entry.release();
      entry.release = this.#attach(entry.mark);
    }
  }

  #sync(): void {
    const needed = this.#alive && this.#handles.size === 0;
    if (needed && !this.#fallback) {
      const mark: Mark = {
        element: this.node,
        kind: "handle",
        priority: this.#priority,
      };
      this.#fallback = { mark, release: this.#attach(mark) };
    } else if (!needed && this.#fallback) {
      this.#fallback.release();
      this.#fallback = undefined;
    }
  }

  #animate(): void {
    if (this.#request !== undefined || !this.#tracker.animating) return;
    const view = this.node.ownerDocument.defaultView;
    if (view)
      this.#request = view.requestAnimationFrame((time) => this.#tick(time));
  }

  #tick(time: number): void {
    this.#request = undefined;
    const tracker = this.#tracker;
    if (!tracker.active) return;
    tracker.tick(time);
    this.#commit();
    this.#notify("onMove");
    if (tracker.animating) this.#animate();
    else if (tracker.released) this.#close();
  }

  #halt(): void {
    if (this.#request === undefined) return;
    this.node.ownerDocument.defaultView?.cancelAnimationFrame(this.#request);
    this.#request = undefined;
  }

  #close(): void {
    this.#halt();
    this.#unlock();
    this.#tracker.end();
    this.#notify("onEnd");
  }

  #commit(): void {
    this.#view.store.commit(this.#tracker.state, this.#tracker);
  }

  #unlock(): void {
    this.#view.store.unlock(this.#tracker);
    this.#scroll?.abort();
    this.#scroll = undefined;
  }

  #notify(name: keyof Observer): void {
    const frame = this.#frame;
    if (observers.size === 0 || !frame) return;
    const session: Session = {
      node: this.node,
      state: this.#tracker.state,
      frame,
      action: this.#tracker.action,
      input: this.#input,
      data: this.#options.data,
    };
    for (const observer of [...observers]) observer[name]?.(session);
  }
}

export const bind = (node: HTMLElement, options: BindOptions): Binding =>
  new Binding(node, options);

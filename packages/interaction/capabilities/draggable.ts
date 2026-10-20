import { plane } from "@openconsole/matrix";

import { transform, type Plugin, type State, type Step } from "../core";
import { bind, type Binding, type BindOptions, type Keys } from "../dom";
import { bounds, grid, gridlines } from "../plugins";

export interface DraggableOptions extends Omit<BindOptions, "action"> {
  readonly container?: HTMLElement;
  readonly grid?: number;
  readonly snap?: boolean;
  readonly lines?: boolean;
}

type Settings = Pick<DraggableOptions, "grid" | "snap" | "lines" | "plugins">;

export class Draggable {
  readonly node: HTMLElement;
  readonly #binding: Binding;
  readonly #container: HTMLElement | undefined;
  #settings: Settings;

  constructor(node: HTMLElement, options: DraggableOptions = {}) {
    this.node = node;
    this.#container = options.container;
    this.#settings = options;
    this.#binding = bind(node, {
      ...options,
      action: transform({ translate: true }),
      plugins: this.#plugins(),
      keys: options.keys ?? this.#keys(),
    });
  }

  get state(): State {
    return this.#binding.state;
  }

  get active(): boolean {
    return this.#binding.active;
  }

  use(plugins: Plugin | readonly Plugin[]): this {
    const { plugins: current = [] } = this.#settings;
    return this.update({ plugins: [...new Set(current.concat(plugins))] });
  }

  update(options: Settings & Pick<DraggableOptions, "matrix">): this {
    const { matrix, ...settings } = options;
    this.#settings = { ...this.#settings, ...settings };
    this.#binding.update({
      matrix,
      plugins: Object.keys(settings).length > 0 ? this.#plugins() : undefined,
    });
    return this;
  }

  handle(element: Element, options?: { readonly priority?: number }) {
    return this.#binding.handle(element, options);
  }

  ignore(element: Element, options?: { readonly priority?: number }) {
    return this.#binding.ignore(element, options);
  }

  destroy(): this {
    this.#binding.destroy();
    return this;
  }

  [Symbol.dispose](): void {
    this.destroy();
  }

  #keys(): Keys {
    const move = (x: number, y: number, factor: number) => (): Step => {
      const { grid: step = 0 } = this.#settings;
      const unit = factor * (step > 0 ? step : 1);
      return {
        matrix: plane.translate(x * unit, y * unit),
        space: "container",
      };
    };
    return {
      ArrowLeft: move(-1, 0, 1),
      ArrowRight: move(1, 0, 1),
      ArrowUp: move(0, -1, 1),
      ArrowDown: move(0, 1, 1),
      "Shift+ArrowLeft": move(-1, 0, 10),
      "Shift+ArrowRight": move(1, 0, 10),
      "Shift+ArrowUp": move(0, -1, 10),
      "Shift+ArrowDown": move(0, 1, 10),
    };
  }

  #plugins(): readonly Plugin[] {
    const {
      grid: step = 0,
      snap = true,
      lines = true,
      plugins = [],
    } = this.#settings;
    const container = this.#container;
    return [
      ...(step > 0 && snap ? [grid(step)] : []),
      ...plugins,
      ...(container
        ? [
            bounds(() => ({
              left: 0,
              top: 0,
              right: container.clientWidth,
              bottom: container.clientHeight,
            })),
          ]
        : []),
      ...(container && step > 0 && lines ? [gridlines(container, step)] : []),
    ];
  }
}

import { plane, type Point } from "@openconsole/matrix";

import { transform, type Plugin, type State, type Step } from "../core";
import { bind, type Binding, type BindOptions, type Keys } from "../dom";
import { angle } from "../plugins";

export interface RotatableOptions extends Omit<
  BindOptions,
  "action" | "handle"
> {
  readonly handle: Element | readonly Element[];
  readonly pivot?: Point<2>;
  readonly step?: number;
}

type Settings = Pick<RotatableOptions, "pivot" | "step" | "plugins">;

const degree = Math.PI / 180;

export class Rotatable {
  readonly node: HTMLElement;
  readonly #binding: Binding;
  #settings: Settings;

  constructor(node: HTMLElement, options: RotatableOptions) {
    const { pivot } = options;
    this.node = node;
    this.#settings = options;
    this.#binding = bind(node, {
      ...options,
      action: transform({ rotate: true, ...(pivot ? { pivot } : {}) }),
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

  update(options: Pick<RotatableOptions, "step" | "plugins" | "matrix">): this {
    const { matrix, ...settings } = options;
    this.#settings = { ...this.#settings, ...settings };
    this.#binding.update({
      matrix,
      plugins: Object.keys(settings).length > 0 ? this.#plugins() : undefined,
    });
    return this;
  }

  destroy(): this {
    this.#binding.destroy();
    return this;
  }

  [Symbol.dispose](): void {
    this.destroy();
  }

  #plugins(): readonly Plugin[] {
    const { step, plugins = [] } = this.#settings;
    return [...(step ? [angle(step)] : []), ...plugins];
  }

  #keys(): Keys {
    const turn =
      (sign: number, factor: number) =>
      (state: State): Step => {
        const { pivot, step = degree } = this.#settings;
        return {
          matrix: plane.around(
            pivot ?? { x: state.size.width / 2, y: state.size.height / 2 },
            plane.rotate(sign * factor * step),
          ),
          space: "local",
        };
      };
    return {
      ArrowLeft: turn(-1, 1),
      ArrowRight: turn(1, 1),
      "Shift+ArrowLeft": turn(-1, 15),
      "Shift+ArrowRight": turn(1, 15),
    };
  }
}

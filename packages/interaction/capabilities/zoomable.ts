import { plane } from "@openconsole/matrix";

import { transform, type Range, type State, type Step } from "../core";
import { bind, wheel, type Binding, type BindOptions, type Keys } from "../dom";
import { limits } from "../plugins";

export interface ZoomableOptions extends Omit<
  BindOptions,
  "action" | "handle"
> {
  readonly viewport: HTMLElement;
  readonly wheel?: boolean;
  readonly rotate?: boolean;
  readonly scale?: Range;
  readonly speed?: number;
}

export class Zoomable {
  readonly node: HTMLElement;
  readonly viewport: HTMLElement;
  readonly #binding: Binding;
  readonly #release: (() => void) | undefined;

  constructor(world: HTMLElement, options: ZoomableOptions) {
    const { viewport, rotate = false, plugins = [] } = options;
    this.node = world;
    this.viewport = viewport;
    this.#binding = bind(world, {
      ...options,
      handle: viewport,
      action: transform({ translate: true, rotate, scale: true }),
      plugins: [
        ...plugins,
        limits({ scale: options.scale ?? { min: 0.1, max: 8 } }),
      ],
      keys: options.keys ?? this.#keys(),
    });
    this.#release =
      options.wheel === false
        ? undefined
        : wheel(viewport, this.#binding, options.speed ?? 0.0015);
  }

  get state(): State {
    return this.#binding.state;
  }

  get active(): boolean {
    return this.#binding.active;
  }

  update(options: Pick<ZoomableOptions, "matrix">): this {
    this.#binding.update(options);
    return this;
  }

  destroy(): this {
    this.#release?.();
    this.#binding.destroy();
    return this;
  }

  [Symbol.dispose](): void {
    this.destroy();
  }

  #keys(): Keys {
    const zoom = (factor: number) => (): Step => ({
      matrix: plane.around(
        {
          x: this.viewport.clientWidth / 2,
          y: this.viewport.clientHeight / 2,
        },
        plane.scale(factor),
      ),
      space: "container",
    });
    const pan = (x: number, y: number): Step => ({
      matrix: plane.translate(x, y),
      space: "container",
    });
    return {
      "+": zoom(1.25),
      "=": zoom(1.25),
      "-": zoom(0.8),
      ArrowLeft: pan(-20, 0),
      ArrowRight: pan(20, 0),
      ArrowUp: pan(0, -20),
      ArrowDown: pan(0, 20),
    };
  }
}

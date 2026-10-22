import { plane } from "@openconsole/matrix";

import { transform, type Step } from "../core";
import {
  arrows,
  bind,
  keyboard,
  pointer,
  View,
  wheel,
  type Binding,
  type BindOptions,
  type Sensor,
} from "../dom";
import { Shape, type CapabilityOptions, type Part, type Range } from "../model";
import { limits } from "../plugins";

export interface ZoomableOptions
  extends Omit<BindOptions, "action" | "handle">, CapabilityOptions {
  readonly viewport: HTMLElement;
  readonly rotate?: boolean;
  readonly scale?: Range;
}

const sensors: readonly Sensor[] = [pointer(), keyboard(), wheel()];

export class Zoomable extends Shape<HTMLElement, ZoomableOptions, Binding> {
  constructor(world: HTMLElement, options: ZoomableOptions) {
    super(world, View.of(world).store, options);
    this.refresh();
  }

  protected build(): readonly Part<Binding>[] {
    return [bind(this.node, this.#config())];
  }

  protected apply(): boolean {
    for (const binding of this.units) binding.update(this.#config());
    return true;
  }

  #config(): BindOptions {
    const {
      viewport,
      rotate = false,
      scale = { min: 0.1, max: 8 },
      plugins = [],
      keys,
    } = this.options;
    const zoom = (factor: number) => (): Step => ({
      matrix: plane.around(
        { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 },
        plane.scale(factor),
      ),
      space: "container",
    });
    return {
      sensors,
      ...this.options,
      handle: viewport,
      action: transform({ translate: true, rotate, scale: true }),
      plugins: [...plugins, limits({ scale })],
      keys: keys ?? {
        ...arrows(20),
        "+": zoom(1.25),
        "=": zoom(1.25),
        "-": zoom(0.8),
      },
    };
  }
}

import { plane } from "@openconsole/matrix";

import { transform, type Step } from "../core";
import { arrows, bind, View, wheel, type BindOptions } from "../dom";
import { Shape, type CapabilityOptions, type Part, type Range } from "../model";
import { limits } from "../plugins";

export interface ZoomableOptions
  extends Omit<BindOptions, "action" | "handle">, CapabilityOptions {
  readonly viewport: HTMLElement;
  readonly wheel?: boolean;
  readonly rotate?: boolean;
  readonly scale?: Range;
  readonly speed?: number;
}

export class Zoomable extends Shape<HTMLElement, ZoomableOptions> {
  constructor(world: HTMLElement, options: ZoomableOptions) {
    super(world, View.of(world).store, options);
    this.refresh();
  }

  protected build(): readonly Part[] {
    const {
      viewport,
      rotate = false,
      scale = { min: 0.1, max: 8 },
      speed = 0.0015,
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
    const binding = bind(this.node, {
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
    });
    return this.options.wheel === false
      ? [binding]
      : [binding, wheel(viewport, binding, speed)];
  }
}

import { transform } from "../core";
import { area, arrows, bind, gridlines, View, type BindOptions } from "../dom";
import { Shape, type CapabilityOptions, type Part } from "../model";
import { bounds, grid } from "../plugins";

export interface DraggableOptions
  extends Omit<BindOptions, "action">, CapabilityOptions {
  readonly container?: HTMLElement;
  readonly grid?: number;
  readonly snap?: boolean;
  readonly lines?: boolean;
}

export class Draggable extends Shape<HTMLElement, DraggableOptions> {
  constructor(node: HTMLElement, options: DraggableOptions = {}) {
    super(node, View.of(node).store, options);
    this.refresh();
  }

  protected build(): readonly Part[] {
    const {
      container,
      grid: step = 0,
      snap = true,
      lines = true,
      plugins = [],
      keys,
    } = this.options;
    return [
      bind(this.node, {
        ...this.options,
        action: transform({ translate: true }),
        plugins: [
          ...(step > 0 && snap ? [grid(step)] : []),
          ...plugins,
          ...(container ? [bounds(area(container))] : []),
          ...(container && step > 0 && lines
            ? [gridlines(container, step)]
            : []),
        ],
        keys: keys ?? arrows(step > 0 ? step : 1),
      }),
    ];
  }
}

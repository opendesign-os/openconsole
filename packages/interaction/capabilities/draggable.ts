import { transform } from "../core";
import {
  arrows,
  bind,
  gridlines,
  guides,
  lift,
  nest,
  outlines,
  region,
  View,
  type BindOptions,
} from "../dom";
import { Shape, type CapabilityOptions, type Part } from "../model";
import { bounds, collide, grid, magnet } from "../plugins";

export interface DraggableOptions
  extends Omit<BindOptions, "action">, CapabilityOptions {
  readonly container?: HTMLElement;
  readonly grid?: number;
  readonly lines?: boolean;
  readonly magnet?: boolean | string;
  readonly collide?: boolean | string;
  readonly nest?: string;
}

export class Draggable extends Shape<HTMLElement, DraggableOptions> {
  constructor(node: HTMLElement, options: DraggableOptions = {}) {
    super(node, View.of(node).store, options);
    this.refresh();
  }

  protected build(): readonly Part[] {
    const { node, options } = this;
    const { container, grid: step = 0, lines = true, plugins = [] } = options;
    const scope = container ?? node.ownerDocument;
    const home = container ?? node.parentElement;
    return [
      bind(node, {
        ...options,
        action: transform({ translate: true }),
        plugins: [
          step > 0 ? grid(step) : undefined,
          options.magnet
            ? magnet(outlines(node, options.magnet, scope), {
                onSnap: guides(() => node.offsetParent),
              })
            : undefined,
          ...plugins,
          container && bounds(region(container, node)),
          options.collide
            ? collide(outlines(node, options.collide, scope))
            : undefined,
          lift(node, container),
          options.nest && home ? nest(node, home, options.nest) : undefined,
          container && step > 0 && lines
            ? gridlines(container, step)
            : undefined,
        ].filter((plugin) => plugin !== undefined),
        keys: options.keys ?? arrows(step > 0 ? step : 1),
      }),
    ];
  }
}

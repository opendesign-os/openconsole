import { space, type Matrix } from "@openconsole/matrix";

import { bounds } from "../plugins/bounds";
import { grid } from "../plugins/grid";
import { gridlines } from "../plugins/gridlines";
import { frame } from "./frame";
import { bind } from "./pointer";
import { Tracker, type Options, type Plugin } from "./tracker";

export interface DraggableOptions extends Options<PointerEvent> {
  grid?: number;
  snap?: boolean;
  lines?: boolean;
}

export class Draggable {
  readonly node: HTMLElement;
  readonly container: HTMLElement;
  readonly #tracker: Tracker<PointerEvent>;
  #settings: Omit<DraggableOptions, "matrix">;
  #hint = "";
  readonly #touch: string;
  readonly #release: () => void;

  constructor(
    node: HTMLElement,
    container: HTMLElement,
    options: DraggableOptions = {},
  ) {
    const { matrix, ...settings } = options;
    this.node = node;
    this.container = container;
    this.#settings = settings;
    this.#tracker = new Tracker({
      matrix: matrix ?? space.parse(getComputedStyle(node).transform || "none"),
      plugins: this.#plugins(),
    });
    this.#touch = node.style.touchAction;
    node.style.touchAction = "none";
    if (matrix) this.#render();
    this.#release = bind(node, {
      start: (event) => this.#start(event),
      move: (event) => this.#move(event),
      end: (event) => this.#end(event),
    });
  }

  get matrix(): Matrix<3, "projective"> {
    return this.#tracker.matrix;
  }

  get dragging(): boolean {
    return this.#tracker.dragging;
  }

  use(plugins: Plugin<PointerEvent> | readonly Plugin<PointerEvent>[]): this {
    const { plugins: current = [] } = this.#settings;
    return this.update({ plugins: [...new Set(current.concat(plugins))] });
  }

  update(options: DraggableOptions): this {
    const { matrix, ...settings } = options;
    if (Object.keys(settings).length > 0) {
      this.#settings = { ...this.#settings, ...settings };
      this.#tracker.update({ plugins: this.#plugins() });
    }
    if (matrix) {
      this.#tracker.update({ matrix });
      this.#render();
    }
    return this;
  }

  destroy(): this {
    this.#release();
    this.#tracker.destroy();
    this.node.style.touchAction = this.#touch;
    return this;
  }

  [Symbol.dispose](): void {
    this.destroy();
  }

  #start(event: PointerEvent): void {
    this.#hint = this.node.style.willChange;
    this.node.style.willChange = "transform";
    this.#tracker.start(event, frame(this.node));
  }

  #move(event: PointerEvent): void {
    this.#tracker.move(event);
    this.#render();
  }

  #end(event: PointerEvent): void {
    this.node.style.willChange = this.#hint;
    this.#tracker.end(event);
  }

  #render(): void {
    this.node.style.transform = space.format(this.#tracker.matrix);
  }

  #plugins(): readonly Plugin<PointerEvent>[] {
    const {
      grid: step = 0,
      snap = true,
      lines = true,
      plugins = [],
    } = this.#settings;
    const { node, container } = this;
    const inside = bounds(() => ({
      left: -node.offsetLeft,
      top: -node.offsetTop,
      right: container.clientWidth - node.offsetWidth - node.offsetLeft,
      bottom: container.clientHeight - node.offsetHeight - node.offsetTop,
    }));
    return [
      ...(step > 0 && snap ? [grid(step)] : []),
      inside,
      ...(step > 0 && lines ? [gridlines(container, step)] : []),
      ...plugins,
    ];
  }
}

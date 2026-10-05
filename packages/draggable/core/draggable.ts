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

interface Settings {
  readonly grid: number;
  readonly snap: boolean;
  readonly lines: boolean;
  readonly use: readonly Plugin<PointerEvent>[];
}

export class Draggable {
  readonly node: HTMLElement;
  readonly #tracker: Tracker<PointerEvent>;
  #settings: Settings;
  #hint = "";
  readonly #touch: string;
  readonly #release: () => void;

  constructor(node: HTMLElement, options: DraggableOptions = {}) {
    const { matrix, ...settings } = options;
    this.node = node;
    this.#settings = { grid: 0, snap: true, lines: true, use: [], ...settings };
    this.#tracker = new Tracker({
      matrix: matrix ?? space.parse(getComputedStyle(node).transform),
      use: this.#plugins(),
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

  update(options: DraggableOptions): void {
    const { matrix, ...settings } = options;
    if (Object.keys(settings).length > 0) {
      this.#settings = { ...this.#settings, ...settings };
      this.#tracker.update({ use: this.#plugins() });
    }
    if (!matrix) return;
    this.#tracker.update({ matrix });
    this.#render();
  }

  destroy(): void {
    this.#release();
    this.#tracker.destroy();
    this.node.style.touchAction = this.#touch;
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
    const { grid: step, snap, lines, use } = this.#settings;
    const node = this.node;
    const container = step > 0 ? node.offsetParent : null;
    if (!(container instanceof HTMLElement)) return use;
    const inside = bounds(() => ({
      left: -node.offsetLeft,
      top: -node.offsetTop,
      right: container.clientWidth - node.offsetWidth - node.offsetLeft,
      bottom: container.clientHeight - node.offsetHeight - node.offsetTop,
    }));
    return [
      ...(snap ? [grid(step)] : []),
      inside,
      ...(lines ? [gridlines(container, step)] : []),
      ...use,
    ];
  }
}

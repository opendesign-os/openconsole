import { plane, type Point } from "@openconsole/matrix";

import { transform, type Step } from "../core";
import {
  bind,
  knob,
  View,
  type Binding,
  type BindOptions,
  type Keys,
} from "../dom";
import { Shape, type CapabilityOptions, type Part, type State } from "../model";
import { angle } from "../plugins";

export interface RotatableOptions
  extends Omit<BindOptions, "action" | "handle">, CapabilityOptions {
  readonly handle?: Element | readonly Element[];
  readonly pivot?: Point<2>;
  readonly step?: number;
}

function turns(pivot: Point<2> | undefined, unit: number): Keys {
  const turn =
    (factor: number) =>
    (state: State): Step => ({
      matrix: plane.around(
        pivot ?? { x: state.size.width / 2, y: state.size.height / 2 },
        plane.rotate(factor * unit),
      ),
      space: "local",
    });
  return {
    ArrowLeft: turn(-1),
    ArrowRight: turn(1),
    "Shift+ArrowLeft": turn(-15),
    "Shift+ArrowRight": turn(15),
  };
}

export class Rotatable extends Shape<HTMLElement, RotatableOptions> {
  constructor(node: HTMLElement, options: RotatableOptions = {}) {
    super(node, View.of(node).store, options);
    this.refresh();
  }

  protected build(): readonly Part[] {
    const { handle } = this.options;
    if (handle) return [this.#bind(handle)];
    const grip = knob(this.node);
    return [this.#bind(grip), () => grip.remove()];
  }

  #bind(handle: Element | readonly Element[]): Binding {
    const { pivot, step, plugins = [], keys } = this.options;
    return bind(this.node, {
      ...this.options,
      handle,
      action: transform({ rotate: true, ...(pivot ? { pivot } : {}) }),
      plugins: [step ? angle(step) : undefined, ...plugins].filter(
        (plugin) => plugin !== undefined,
      ),
      keys: keys ?? turns(pivot, step ?? Math.PI / 180),
    });
  }
}

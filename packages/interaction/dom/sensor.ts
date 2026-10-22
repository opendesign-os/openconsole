import type { Point } from "@openconsole/matrix";

import type { Action, Input, Step } from "../core";
import type { State } from "../model";

export interface Activation {
  readonly distance?: number;
  readonly delay?: number;
  readonly tolerance?: number;
}

export type Key = Step | ((state: State) => Step | undefined);

export type Keys = Readonly<Record<string, Key>>;

export interface Control {
  readonly node: HTMLElement;
  readonly state: State;
  readonly action: Action;
  readonly keys: Keys;
  activation(type: string): Activation;
  start(input: Input): boolean;
  move(input: Input): void;
  nudge(step: Step): void;
  end(input?: Input): void;
  cancel(): void;
}

export interface Mark {
  readonly element: Element;
  readonly kind: "handle" | "ignore";
  readonly priority: number;
}

export type Sensor = (control: Control, mark: Mark) => (() => void) | undefined;

export const input = (
  event: MouseEvent | KeyboardEvent,
  points: Iterable<Point<2>> = [],
): Input => ({
  points: [...points],
  modifiers: {
    shift: event.shiftKey,
    alt: event.altKey,
    control: event.ctrlKey,
    meta: event.metaKey,
  },
  event,
  timestamp: event.timeStamp,
});

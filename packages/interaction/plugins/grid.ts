import { space } from "@openconsole/matrix";

import type { Plugin } from "../core/tracker";

export function grid(step: number): Plugin {
  if (!(Number.isFinite(step) && step > 0)) {
    throw new RangeError(`expected a positive step, received ${step}`);
  }
  const offset = (value: number) => Math.round(value / step) * step - value;
  return {
    onMove: ({ matrix }) =>
      space.multiply(
        space.translate(offset(matrix[12]), offset(matrix[13]), 0),
        matrix,
      ),
  };
}

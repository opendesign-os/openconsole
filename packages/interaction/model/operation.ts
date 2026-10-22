import { plane, type Matrix } from "@openconsole/matrix";

import type { Size, State } from "./state";

export interface Operation {
  readonly matrix: Matrix<2, "affine">;
  readonly size: Size;
}

export function delta(from: State, to: State): Operation | undefined {
  const inverse = plane.invert(from.matrix);
  if (!inverse) return undefined;
  return {
    matrix: plane.multiply(to.matrix, inverse),
    size: {
      width: to.size.width - from.size.width,
      height: to.size.height - from.size.height,
    },
  };
}

export const perform = (operation: Operation, state: State): State => ({
  ...state,
  matrix: plane.multiply(operation.matrix, state.matrix),
  size: {
    width: state.size.width + operation.size.width,
    height: state.size.height + operation.size.height,
  },
});

export function revert(operation: Operation, state: State): State | undefined {
  const inverse = plane.invert(operation.matrix);
  if (!inverse) return undefined;
  return {
    ...state,
    matrix: plane.multiply(inverse, state.matrix),
    size: {
      width: state.size.width - operation.size.width,
      height: state.size.height - operation.size.height,
    },
  };
}

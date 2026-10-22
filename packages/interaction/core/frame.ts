import { plane, type Matrix } from "@openconsole/matrix";

import type { Bounds, State } from "../model";

export function convert(
  matrix: Matrix<2, "affine">,
  from: Matrix<2, "affine">,
  to: Matrix<2, "affine">,
): Matrix<2, "affine"> | undefined {
  const inverse = plane.invert(from);
  return inverse && plane.multiply(to, inverse, matrix);
}

export function frame(
  linear: Matrix<2, "affine">,
  box: Bounds,
  state: State,
): Matrix<2, "affine"> | undefined {
  const [a, b, c, d] = linear;
  const middle = plane.apply(state.matrix, {
    x: state.size.width / 2,
    y: state.size.height / 2,
  });
  return plane.invert([
    a,
    b,
    c,
    d,
    (box.left + box.right) / 2 - (a * middle.x + c * middle.y),
    (box.top + box.bottom) / 2 - (b * middle.x + d * middle.y),
  ]);
}

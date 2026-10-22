/**
 * @file 元操作：一次会话对状态的净变化，以及求差、施加、撤回三个纯函数。
 *
 * 元操作以增量表达，撤回作用在当前状态上，中间夹着别的变化时仍然成立；
 * 矩阵相乘不可交换，多条元操作要按发生顺序施加。
 */

import { plane, type Matrix } from "@openconsole/matrix";

import type { Size, State } from "./state";

/**
 * 一次会话对状态的净变化：容器空间里的净变换加宽高增量。
 *
 * 序号与跨容器移交不在其中：排序、移交是结构变化，由各自的事件报告。
 */
export interface Operation {
  /** 容器空间里的净变换，满足 `to.matrix = matrix·from.matrix`。 */
  readonly matrix: Matrix<2, "affine">;
  /** 宽高增量，满足 `to.size = from.size + size`。 */
  readonly size: Size;
}

/**
 * 求两个状态之间的净变化。
 *
 * @param from 起始状态。
 * @param to 结束状态。
 * @returns 满足 `perform(operation, from)` 等于 `to` 的元操作；
 *   `from.matrix` 不可逆时为 `undefined`。
 * @example
 * const operation = delta(start, end);
 * if (operation) history.push(operation);
 */
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

/**
 * 把元操作施加到状态上，用于重做与回放。
 *
 * @param operation 元操作。
 * @param state 当前状态。
 * @returns 新状态，序号保持不变。
 * @example
 * drag.assign(perform(operation, drag.state));
 */
export const perform = (operation: Operation, state: State): State => ({
  ...state,
  matrix: plane.multiply(operation.matrix, state.matrix),
  size: {
    width: state.size.width + operation.size.width,
    height: state.size.height + operation.size.height,
  },
});

/**
 * 从状态上撤回元操作，用于撤销。
 *
 * @param operation 要撤回的元操作。
 * @param state 当前状态。
 * @returns 新状态，序号保持不变；`operation.matrix` 不可逆时为 `undefined`。
 * @example
 * const state = revert(operation, drag.state);
 * if (state) drag.assign(state);
 */
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

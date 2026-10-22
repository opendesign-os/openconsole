/**
 * @file 排序：选插入位置、求插入位次，以及不移动被拖元素的 DOM 重排计划。
 */

import type { Point } from "@openconsole/matrix";

import type { Bounds } from "../model";

/**
 * 插入位置判定：给出判定点与各条目的盒（同一空间），返回目标位置，-1 表示没有。
 *
 * `Sortable` 用被拖元素的中心与各条目在容器空间里的盒调用它。
 */
export type Slot = (point: Point<2>, boxes: readonly Bounds[]) => number;

/**
 * 一次重排的 DOM 移动计划：把这些位置上的条目移到被拖元素之前或之后。
 *
 * 移动其他条目而不是被拖元素本身：被指针捕获的元素一旦移出 DOM 就会丢失指针捕获，会话随之结束。
 */
export interface Plan {
  /** 要移到被拖元素之前的条目位置，按原顺序。 */
  readonly before: readonly number[];
  /** 要移到被拖元素之后的条目位置，按原顺序。 */
  readonly after: readonly number[];
}

/**
 * 默认的插入位置判定：取中心离判定点最近的条目。
 *
 * @param point 判定点。
 * @param boxes 各条目的盒。
 * @returns 最近条目的位置；没有条目时为 -1。
 */
export const closest: Slot = (point, boxes) => {
  let index = -1;
  let nearest = Infinity;
  boxes.forEach((bounds, position) => {
    const distance = Math.hypot(
      (bounds.left + bounds.right) / 2 - point.x,
      (bounds.top + bounds.bottom) / 2 - point.y,
    );
    if (distance < nearest) {
      nearest = distance;
      index = position;
    }
  });
  return index;
};

/**
 * 求插入位次：`value` 之前有多少个中点，即应插在第几个条目之前。
 *
 * @param value 判定点在排列方向上的坐标。
 * @param middles 其余条目在同一方向上的中点，按顺序排列。
 * @returns 插入位次，0 表示最前。
 * @example
 * rank(15, [10, 20, 30]); // 1：插在第二个条目之前
 */
export const rank = (value: number, middles: readonly number[]): number =>
  middles.filter((middle) => middle < value).length;

/** 整数序列 `[from, to)`。 */
const span = (from: number, to: number): number[] =>
  Array.from({ length: Math.max(0, to - from) }, (_, offset) => from + offset);

/**
 * 求把条目从 `current` 移到 `target` 的重排计划，被拖元素本身保持不动。
 *
 * 向后移时，把两者之间直到 `target` 的条目移到它之前；向前移时，把它们移到它之后。
 *
 * @param current 被拖条目的当前位置。
 * @param target 目标位置。
 * @returns 重排计划。
 * @example
 * arrange(0, 2); // { before: [1, 2], after: [] }
 * arrange(3, 1); // { before: [], after: [1, 2] }
 */
export function arrange(current: number, target: number): Plan {
  return target > current
    ? { before: span(current + 1, target + 1), after: [] }
    : { before: [], after: span(target, current) };
}

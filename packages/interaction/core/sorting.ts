/**
 * @file 排序：选插入位置、求插入位次，以及不移动被拖元素的 DOM 重排计划。
 *
 * `Sortable` 用 {@link closest} 选位置、用 {@link arrange} 重排；`Nestable` 用 {@link locate}
 * 按区域的排列方式求跨列表插入的位次与插入线。这里只做纯计算，不读写 DOM。
 */

import type { Point } from "@openconsole/matrix";

import type { Bounds, Span } from "../model";

/**
 * 插入位置判定：给出判定点与各条目的盒（同一空间），返回目标位置，-1 表示没有。
 *
 * `Sortable` 用被拖元素候选状态的中心与各条目在容器空间里的盒（含被拖条目自身）调用它，
 * 返回值写进状态的 `index`；返回 -1 时不改动候选。
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
 * 距离为盒中心到判定点的欧氏距离；距离相同时取靠前的条目。
 *
 * @param point 判定点。
 * @param boxes 各条目的盒，与 `point` 同一空间。
 * @returns 最近条目的位置；没有条目时为 -1。
 * @example
 * closest({ x: 0, y: 25 }, [
 *   { left: 0, top: 0, right: 100, bottom: 20 },
 *   { left: 0, top: 20, right: 100, bottom: 40 },
 * ]); // 1：第二个条目的中心 (50, 30) 更近
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
 * 只计严格小于 `value` 的中点，恰好落在中点上时插在该条目之前。
 *
 * @param value 判定点在排列方向上的坐标。
 * @param middles 其余条目（不含被拖条目）在同一方向上的中点，按顺序排列。
 * @returns 插入位次，0 表示最前，`middles.length` 表示最后。
 * @example
 * rank(15, [10, 20, 30]); // 1：插在第二个条目之前
 */
export const rank = (value: number, middles: readonly number[]): number =>
  middles.filter((middle) => middle < value).length;

/** 区域里条目的排列方式，决定插入位次按什么顺序数。 */
export interface Flow {
  /** 主轴是否横向：横向时条目在一行里从左往右排，否则在一列里从上往下排。 */
  readonly row: boolean;
  /** 主轴是否反向：DOM 顺序在屏幕上从右往左或从下往上，如 `row-reverse`、RTL 下的横向排列。 */
  readonly reverse: boolean;
  /** 条目是否可能分成多行（主轴横向时）或多列（主轴纵向时），如换行的 flex、多列的 grid。 */
  readonly wrap: boolean;
}

/** {@link locate} 的结果：插入位次与插入线。 */
export interface Insertion {
  /** 插入位次：应插在第几个条目之前，0 表示最前，条目数表示最后。 */
  readonly index: number;
  /** 插入线的两个端点，与条目同一空间：垂直于主轴，落在相邻条目的间隙中间。 */
  readonly line: readonly [Point<2>, Point<2>];
}

/** 一行条目（主轴纵向时为一列）：在交叉轴上相互重叠的连续条目。 */
interface Line {
  /** 行首条目的位置。 */
  first: number;
  /** 行尾条目的位置。 */
  last: number;
  /** 这一行在交叉轴上的范围。 */
  band: Span;
}

/**
 * 求判定点在一组条目里的插入位置。
 *
 * 可能换行时，先把交叉轴上相互重叠的连续条目归为一行，取判定点所在（或交叉轴上最近）的一行；
 * 不换行时所有条目都在同一行。再在这一行里数主轴中点位于判定点之前的条目（反向时数之后的），
 * 加上前面各行的条目数即为位次。插入线落在行内相邻两个条目的间隙中间，只有一行时横跨整个区域，
 * 多行时只跨这一行。
 *
 * @param point 判定点。
 * @param boxes 条目的盒，按 DOM 顺序，不含被拖条目，与 `point` 同一空间。
 * @param zone 区域的盒：没有条目时插入线画在区域中线上，只有一行时插入线横跨它。
 * @param flow 区域的排列方式。
 * @returns 插入位次与插入线。
 * @example
 * const boxes = [
 *   { left: 0, top: 0, right: 40, bottom: 20 },
 *   { left: 50, top: 0, right: 90, bottom: 20 },
 * ];
 * const zone = { left: 0, top: 0, right: 100, bottom: 20 };
 * locate({ x: 60, y: 10 }, boxes, zone, { row: true, reverse: false, wrap: false });
 * // { index: 1, line: [{ x: 45, y: 0 }, { x: 45, y: 20 }] }：插在第二个条目之前
 */
export function locate(
  point: Point<2>,
  boxes: readonly Bounds[],
  zone: Bounds,
  { row, reverse, wrap }: Flow,
): Insertion {
  /** 盒在主轴上的范围。 */
  const main = (box: Bounds): Span =>
    row ? { min: box.left, max: box.right } : { min: box.top, max: box.bottom };
  /** 盒在交叉轴上的范围。 */
  const cross = (box: Bounds): Span =>
    row ? { min: box.top, max: box.bottom } : { min: box.left, max: box.right };
  const lines: Line[] = [];
  boxes.forEach((box, position) => {
    const band = cross(box);
    const line = lines.at(-1);
    if (
      line &&
      (!wrap || (band.min < line.band.max && band.max > line.band.min))
    ) {
      line.last = position;
      line.band = {
        min: Math.min(line.band.min, band.min),
        max: Math.max(line.band.max, band.max),
      };
    } else {
      lines.push({ first: position, last: position, band });
    }
  });
  const across = row ? point.y : point.x;
  /** 判定点到一行在交叉轴上的距离，落在行内为 0。 */
  const distance = ({ band }: Line) =>
    Math.max(band.min - across, across - band.max, 0);
  const line = lines.reduce<Line | undefined>(
    (best, current) =>
      !best || distance(current) < distance(best) ? current : best,
    undefined,
  );
  const members = line ? boxes.slice(line.first, line.last + 1) : [];
  /** 反向时坐标取负，让 DOM 顺序在主轴上递增。 */
  const sign = reverse ? -1 : 1;
  const offset = rank(
    sign * (row ? point.x : point.y),
    members.map((box) => (sign * (main(box).min + main(box).max)) / 2),
  );
  /** 盒在排列方向上的起边：反向时为右边或下边。 */
  const head = (box: Bounds) => (reverse ? main(box).max : main(box).min);
  /** 盒在排列方向上的终边：反向时为左边或上边。 */
  const tail = (box: Bounds) => (reverse ? main(box).min : main(box).max);
  const before = members[offset - 1];
  const after = members[offset];
  const position =
    before && after
      ? (tail(before) + head(after)) / 2
      : after
        ? head(after)
        : before
          ? tail(before)
          : (main(zone).min + main(zone).max) / 2;
  const band = line && lines.length > 1 ? line.band : cross(zone);
  return {
    index: (line?.first ?? 0) + offset,
    line: row
      ? [
          { x: position, y: band.min },
          { x: position, y: band.max },
        ]
      : [
          { x: band.min, y: position },
          { x: band.max, y: position },
        ],
  };
}

/**
 * 生成整数序列 `[from, to)`。
 *
 * @param from 起点（含）。
 * @param to 终点（不含）；不大于 `from` 时得到空数组。
 * @returns 递增的整数序列。
 */
const span = (from: number, to: number): number[] =>
  Array.from({ length: Math.max(0, to - from) }, (_, offset) => from + offset);

/**
 * 求把条目从 `current` 移到 `target` 的重排计划，被拖元素本身保持不动。
 *
 * 向后移时，把两者之间直到 `target` 的条目移到它之前；向前移时，把它们移到它之后。
 * 两个位置相同时两个列表都为空。
 *
 * @param current 被拖条目的当前位置。
 * @param target 目标位置。
 * @returns 重排计划，位置都是重排前的位置。
 * @example
 * arrange(0, 2); // { before: [1, 2], after: [] }
 * arrange(3, 1); // { before: [], after: [1, 2] }
 */
export function arrange(current: number, target: number): Plan {
  return target > current
    ? { before: span(current + 1, target + 1), after: [] }
    : { before: [], after: span(target, current) };
}

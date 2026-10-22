/**
 * @file 磁吸插件：把被拖元素吸到目标的边与中线，或与相邻目标保持等间距，并输出参考线。
 *
 * 目标与状态都在容器空间，按轴对齐包围盒比较。吸附距离以屏幕像素给出，经 `frame` 换算到容器空间，
 * 缩放的画布里手感一致。对齐与等间距参照 tldraw 与 Moveable 的 snap、snapGap。
 */

import { plane, type Point } from "@openconsole/matrix";

import { pin, resizes, type Context, type Edges, type Plugin } from "../core";
import {
  corners,
  epsilon,
  extent,
  scale,
  type Bounds,
  type Guide,
  type Polygon,
  type Span,
  type State,
} from "../model";

/** {@link magnet} 的选项。 */
export interface MagnetOptions {
  /**
   * 吸附距离，屏幕像素；乘以 `frame` 的缩放得到容器空间里的距离。
   *
   * @default 5
   */
  readonly distance?: number;
  /**
   * 参考线变化时调用，坐标在容器空间；参考线消失（包括会话结束或取消）时收到空数组。
   *
   * 与上一次相同的参考线不重复通知。DOM 侧可直接传 `guides(host)` 的返回值。
   */
  readonly onSnap?: (guides: readonly Guide[]) => void;
}

/** 比较的方向：`x` 比较左、中、右，`y` 比较上、中、下。 */
type Axis = "x" | "y";

/** 一条对齐线：目标在某轴上的起点、中点或终点。 */
interface Line {
  /** 线在该轴上的坐标（容器空间）。 */
  readonly value: number;
  /** 线所属目标的包围盒，画参考线时延伸到它。 */
  readonly box: Bounds;
}

/** 同一轴上前后相邻、且在另一轴上有重叠的两个目标，被拖元素与它们同排时可做等间距吸附。 */
interface Pair {
  /** 该轴上靠前的目标。 */
  readonly before: Bounds;
  /** 紧随其后、间距最小的目标。 */
  readonly after: Bounds;
  /** 两者之间的距离，为正数。 */
  readonly gap: number;
  /** 两者在另一轴上的重叠区间。 */
  readonly shared: Span;
}

/** 会话开始时由目标算好的吸附数据：各轴的对齐线与相邻对。 */
interface Snaps {
  /** 各轴的对齐线：每个目标在该轴上的起点、中点、终点。 */
  readonly lines: Readonly<Record<Axis, readonly Line[]>>;
  /** 各轴的相邻对，用于等间距吸附。 */
  readonly pairs: Readonly<Record<Axis, readonly Pair[]>>;
}

/** 没有目标时的吸附数据：第一次会话开始前使用，什么也吸不到。 */
const empty: Snaps = { lines: { x: [], y: [] }, pairs: { x: [], y: [] } };

/**
 * 包围盒在该轴上的区间。
 *
 * @param box 包围盒。
 * @param axis 轴。
 * @returns `x` 轴为 `[left, right]`，`y` 轴为 `[top, bottom]`。
 */
const along = (box: Bounds, axis: Axis): Span =>
  axis === "x"
    ? { min: box.left, max: box.right }
    : { min: box.top, max: box.bottom };

/**
 * 包围盒在另一轴上的区间。
 *
 * @param box 包围盒。
 * @param axis 当前比较的轴。
 * @returns `x` 轴时为 `[top, bottom]`，`y` 轴时为 `[left, right]`。
 */
const across = (box: Bounds, axis: Axis): Span =>
  axis === "x"
    ? { min: box.top, max: box.bottom }
    : { min: box.left, max: box.right };

/**
 * 由该轴坐标 `value` 与另一轴坐标 `cross` 组成容器空间里的点。
 *
 * @param axis 当前比较的轴。
 * @param value 该轴上的坐标。
 * @param cross 另一轴上的坐标。
 * @returns 容器空间里的点。
 */
const point = (axis: Axis, value: number, cross: number): Point<2> =>
  axis === "x" ? { x: value, y: cross } : { x: cross, y: value };

/**
 * 区间中点。
 *
 * @param span 区间。
 * @returns `(min + max) / 2`。
 */
const middle = ({ min, max }: Span): number => (min + max) / 2;

/**
 * 区间长度。
 *
 * @param span 区间。
 * @returns `max − min`。
 */
const length = ({ min, max }: Span): number => max - min;

/**
 * 区间上可吸附的三个点：起点、中点、终点。
 *
 * @param span 区间。
 * @returns `[min, middle, max]`。
 */
const marks = (span: Span): number[] => [span.min, middle(span), span.max];

/**
 * 两个坐标视为重合，用来判断参考线是否命中。
 *
 * @param left 一个坐标。
 * @param right 另一个坐标。
 * @returns 差值不超过 `epsilon` 时为 `true`。
 */
const near = (left: number, right: number): boolean =>
  Math.abs(left - right) <= epsilon;

/**
 * 两个区间的交集；不相交或只接触时为 `undefined`。
 *
 * @param left 一个区间。
 * @param right 另一个区间。
 * @returns 长度为正的交集区间。
 */
function overlap(left: Span, right: Span): Span | undefined {
  const min = Math.max(left.min, right.min);
  const max = Math.min(left.max, right.max);
  return min < max ? { min, max } : undefined;
}

/**
 * 在 `reach` 内取绝对值最小的偏移；都超出时为 `undefined`。
 *
 * @param offsets 候选偏移。
 * @param reach 允许的最大绝对值（含）。
 * @returns 最近的偏移，同样近时取先出现的。
 */
function nearest(offsets: Iterable<number>, reach: number): number | undefined {
  let best: number | undefined;
  for (const offset of offsets) {
    if (Math.abs(offset) > reach) continue;
    if (best === undefined || Math.abs(offset) < Math.abs(best)) best = offset;
  }
  return best;
}

/**
 * 所有目标在该轴上的对齐线，每个目标三条。
 *
 * @param boxes 目标的包围盒。
 * @param axis 轴。
 * @returns 每个目标的起点、中点、终点线，按目标顺序排列。
 */
const collect = (boxes: readonly Bounds[], axis: Axis): Line[] =>
  boxes.flatMap((box) =>
    marks(along(box, axis)).map((value) => ({ value, box })),
  );

/**
 * 每个目标与其后最近、且在另一轴上有重叠的目标组成相邻对。
 *
 * 「其后」指 `after` 的起点在 `before` 的终点之后（间距大于 `epsilon`）；逐对比较，复杂度为目标数的平方。
 *
 * @param boxes 目标的包围盒。
 * @param axis 轴。
 * @returns 每个目标至多一个相邻对。
 */
function neighbors(boxes: readonly Bounds[], axis: Axis): Pair[] {
  return boxes.flatMap((before) => {
    const end = along(before, axis).max;
    const candidates = boxes.flatMap((after) => {
      const gap = along(after, axis).min - end;
      const shared = overlap(across(before, axis), across(after, axis));
      return gap > epsilon && shared ? [{ before, after, gap, shared }] : [];
    });
    const closest = candidates.reduce<Pair | undefined>(
      (best, pair) => (best && best.gap <= pair.gap ? best : pair),
      undefined,
    );
    return closest ? [closest] : [];
  });
}

/**
 * 等间距吸附的落点，即被拖元素在该轴上的起点坐标。
 *
 * 与被拖元素在另一轴上同排的每个相邻对给出三种落点：在 `after` 之后复制同样的间距、
 * 在 `before` 之前复制同样的间距、放得下时正好居中于两者之间。
 *
 * @param box 被拖元素的包围盒。
 * @param axis 比较的轴。
 * @param pairs 该轴上的相邻对。
 * @returns 候选起点坐标。
 */
function spots(box: Bounds, axis: Axis, pairs: readonly Pair[]): number[] {
  const size = length(along(box, axis));
  return pairs.flatMap((pair) => {
    if (!overlap(across(box, axis), pair.shared)) return [];
    const before = along(pair.before, axis);
    const after = along(pair.after, axis);
    const free = pair.gap - size;
    return [
      after.max + pair.gap,
      before.min - pair.gap - size,
      ...(free >= 0 ? [before.max + free / 2] : []),
    ];
  });
}

/**
 * 平移时该轴的吸附偏移：被拖元素的起点、中点、终点对齐任一对齐线，或落到等间距落点；
 * 取 `reach` 内最近的一个，没有时为 0。
 *
 * @param box 被拖元素的包围盒（容器空间）。
 * @param axis 比较的轴。
 * @param snaps 会话开始时算好的吸附数据。
 * @param reach 吸附距离（容器空间）。
 * @returns 该轴上应加的平移量；没有可吸附的目标时为 0。
 */
function offset(box: Bounds, axis: Axis, snaps: Snaps, reach: number): number {
  const span = along(box, axis);
  const aligned = marks(span).flatMap((source) =>
    snaps.lines[axis].map((line) => line.value - source),
  );
  const spaced = spots(box, axis, snaps.pairs[axis]).map(
    (spot) => spot - span.min,
  );
  return nearest([...aligned, ...spaced], reach) ?? 0;
}

/**
 * 调整尺寸时该轴上的尺寸变化量：只把移动的边吸到最近的对齐线。
 *
 * 两条边各自求吸附量，取较近的一个；起点边向外吸（坐标变小）时尺寸变大，所以取反。
 *
 * @param span 被拖元素在该轴上的区间（容器空间）。
 * @param start 起点那条边是否移动。
 * @param end 终点那条边是否移动。
 * @param lines 该轴上的对齐线。
 * @param reach 吸附距离（容器空间）。
 * @returns 容器空间里的尺寸变化量；两条边同时移动（对称调整）时加倍。
 */
function growth(
  { min, max }: Span,
  start: boolean,
  end: boolean,
  lines: readonly Line[],
  reach: number,
): number {
  /** 把一条边吸到 `reach` 内最近的对齐线所需的位移。 */
  const pull = (source: number) =>
    nearest(
      lines.map((line) => line.value - source),
      reach,
    );
  const low = start ? pull(min) : undefined;
  const high = end ? pull(max) : undefined;
  const changes = [
    ...(low === undefined ? [] : [-low]),
    ...(high === undefined ? [] : [high]),
  ];
  const change = nearest(changes, Infinity) ?? 0;
  return start && end ? change * 2 : change;
}

/**
 * 平移吸附：两轴各自求偏移，在容器空间里平移。
 *
 * @param state 候选状态。
 * @param snaps 会话开始时算好的吸附数据。
 * @param reach 吸附距离（容器空间）。
 * @returns 吸附后的状态；两轴都不需要偏移时原样返回 `state`。
 */
function shift(state: State, snaps: Snaps, reach: number): State {
  const box = extent(corners(state));
  const x = offset(box, "x", snaps, reach);
  const y = offset(box, "y", snaps, reach);
  if (x === 0 && y === 0) return state;
  return {
    ...state,
    matrix: plane.multiply(plane.translate(x, y), state.matrix),
  };
}

/**
 * 调整尺寸吸附，只处理未旋转、未翻转的元素（线性部分为正的对角阵）。
 *
 * 容器空间里的变化量除以 `a`、`d` 换回局部尺寸，再按会话起点钉住对边；元素被旋转时不吸附。
 *
 * @param state 候选状态。
 * @param origin 会话起点，用于钉住对边。
 * @param edges 移动的边。
 * @param snaps 会话开始时算好的吸附数据。
 * @param reach 吸附距离（容器空间）。
 * @returns 吸附后的状态，尺寸不小于 0；不需要吸附时原样返回 `state`；元素被旋转、斜切或翻转时为 `undefined`。
 */
function stretch(
  state: State,
  origin: State,
  edges: Edges,
  snaps: Snaps,
  reach: number,
): State | undefined {
  const [a, b, c, d] = state.matrix;
  const upright =
    Math.abs(b) <= epsilon && Math.abs(c) <= epsilon && a > 0 && d > 0;
  if (!upright) return undefined;
  const box = extent(corners(state));
  const { x, y } = snaps.lines;
  const width = growth(along(box, "x"), edges.left, edges.right, x, reach) / a;
  const height = growth(along(box, "y"), edges.top, edges.bottom, y, reach) / d;
  if (width === 0 && height === 0) return state;
  const size = {
    width: Math.max(0, state.size.width + width),
    height: Math.max(0, state.size.height + height),
  };
  return { ...state, size, matrix: pin(origin, size, edges) };
}

/**
 * 按自由度选择吸附方式：调整尺寸吸移动的边，能平移吸位置，其余动作不吸附。
 * 键盘输入（没有指针点）不吸附，否则每次 1 像素的方向键移不出吸附范围。
 *
 * @param context 插件上下文，用到候选状态、会话起点、输入与动作自由度。
 * @param snaps 会话开始时算好的吸附数据。
 * @param reach 吸附距离（容器空间）。
 * @returns 吸附后的状态；不吸附时为 `undefined`。
 */
function snap(
  { state, origin, input, action: { freedom } }: Context,
  snaps: Snaps,
  reach: number,
): State | undefined {
  if (input.points.length === 0) return undefined;
  if (resizes(freedom)) {
    return stretch(state, origin, freedom.edges, snaps, reach);
  }
  if (freedom.translate) return shift(state, snaps, reach);
  return undefined;
}

/**
 * 命中的对齐线转成参考线：同一坐标上的线合并，从被拖元素延伸到所有命中的目标。
 *
 * @param box 被拖元素吸附后的包围盒。
 * @param axis 比较的轴；`x` 轴上的对齐线是竖线。
 * @param lines 该轴上的对齐线。
 * @returns 对齐参考线（`kind: "align"`），每个命中的坐标一条。
 */
function aligns(box: Bounds, axis: Axis, lines: readonly Line[]): Guide[] {
  const sources = marks(along(box, axis));
  const spans = new Map<number, Span>();
  for (const line of lines) {
    if (!sources.some((source) => near(source, line.value))) continue;
    const span = spans.get(line.value) ?? across(box, axis);
    const target = across(line.box, axis);
    spans.set(line.value, {
      min: Math.min(span.min, target.min),
      max: Math.max(span.max, target.max),
    });
  }
  return [...spans].map(([value, { min, max }]) => ({
    kind: "align",
    from: point(axis, value, min),
    to: point(axis, value, max),
  }));
}

/**
 * 命中的等间距转成参考线（`kind: "gap"`）：原有间距一段，加上被拖元素一侧同样的间距一段；
 * 居中时两段分在被拖元素左右。每段画在两者在另一轴重叠区间的中线上。
 *
 * @param box 被拖元素吸附后的包围盒。
 * @param axis 比较的轴。
 * @param pairs 该轴上的相邻对。
 * @returns 间距参考线；没有命中的等间距时为空数组。
 */
function gaps(box: Bounds, axis: Axis, pairs: readonly Pair[]): Guide[] {
  const span = along(box, axis);
  const cross = across(box, axis);
  /** 沿该轴从 `start` 到 `end` 的一段间距线，画在 `level` 的中线上。 */
  const segment = (start: number, end: number, level: Span): Guide => ({
    kind: "gap",
    from: point(axis, start, middle(level)),
    to: point(axis, end, middle(level)),
  });
  return pairs.flatMap((pair) => {
    const shared = overlap(cross, pair.shared);
    if (!shared) return [];
    const before = along(pair.before, axis);
    const after = along(pair.after, axis);
    const original = segment(before.max, after.min, pair.shared);
    if (near(span.min, after.max + pair.gap)) {
      return [original, segment(after.max, span.min, shared)];
    }
    if (near(span.max, before.min - pair.gap)) {
      return [segment(span.max, before.min, shared), original];
    }
    const free = (pair.gap - length(span)) / 2;
    if (free >= 0 && near(span.min, before.max + free)) {
      return [
        segment(before.max, span.min, shared),
        segment(span.max, after.min, shared),
      ];
    }
    return [];
  });
}

/**
 * 被拖元素在当前位置命中的全部参考线。
 *
 * @param box 被拖元素吸附后的包围盒。
 * @param snaps 会话开始时算好的吸附数据。
 * @returns 两轴的对齐线与间距段。
 */
const guides = (box: Bounds, snaps: Snaps): Guide[] => [
  ...aligns(box, "x", snaps.lines.x),
  ...aligns(box, "y", snaps.lines.y),
  ...gaps(box, "x", snaps.pairs.x),
  ...gaps(box, "y", snaps.pairs.y),
];

/**
 * 参考线的指纹：参考线不变时不重复调用 `onSnap`。
 *
 * @param guides 参考线。
 * @returns 由种类与端点坐标拼成的字符串；空数组为 `""`。
 */
const key = (guides: readonly Guide[]): string =>
  guides
    .map(({ kind, from, to }) => `${kind}${from.x},${from.y},${to.x},${to.y}`)
    .join();

/**
 * 创建磁吸插件：把被拖元素吸到目标的边、中线，或与相邻目标保持等间距，并通过 `onSnap` 输出参考线。
 *
 * - 会话开始时取一次目标，按包围盒预先算好各轴的对齐线与相邻对。
 * - 能平移时吸位置：起点、中点、终点对齐目标的起点、中点、终点；等间距有三种落点，
 *   复制在相邻对之后、复制在之前、居中于两者之间。两轴各自吸附。
 * - 调整尺寸时只吸移动的边，且只在元素未旋转时生效。
 * - `distance` 是屏幕像素，乘以 `frame` 的缩放得到容器空间里的吸附距离。
 * - 键盘移动不吸附。
 *
 * @param targets 返回目标（容器空间里的多边形）的函数，每次会话开始时调用一次。
 * @param options 吸附距离与参考线回调。
 * @returns 实现 `onStart`、`onMove`、`onEnd`、`onCancel` 的插件。
 * @example
 * bind(node, {
 *   action: transform({ translate: true }),
 *   plugins: [magnet(outlines(node, true, board), { onSnap: guides(() => board) })],
 * });
 */
export function magnet(
  targets: (context: Context) => Iterable<Polygon>,
  { distance = 5, onSnap }: MagnetOptions = {},
): Plugin {
  /** 本次会话的吸附数据。 */
  let snaps = empty;
  /** 上一次输出的参考线指纹。 */
  let shown = "";
  /** 参考线变化时才调用 `onSnap`。 */
  const show = (next: readonly Guide[]) => {
    if (key(next) === shown) return;
    shown = key(next);
    onSnap?.(next);
  };
  return {
    /** 取目标的包围盒，预先算好两轴的对齐线与相邻对。 */
    onStart: (context) => {
      const boxes = [...targets(context)].map(extent);
      snaps = {
        lines: { x: collect(boxes, "x"), y: collect(boxes, "y") },
        pairs: { x: neighbors(boxes, "x"), y: neighbors(boxes, "y") },
      };
    },
    /** 按屏幕像素换算的距离吸附，并输出吸附后命中的参考线。 */
    onMove: (context) => {
      const next = snap(context, snaps, distance * scale(context.frame));
      show(next ? guides(extent(corners(next)), snaps) : []);
      return next;
    },
    onEnd: () => show([]),
    onCancel: () => show([]),
  };
}

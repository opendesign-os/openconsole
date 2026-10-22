import { plane, type Matrix, type Point } from "@openconsole/matrix";

import { pin, resizes, type Context, type Edges, type Plugin } from "../core";
import {
  corners,
  epsilon,
  extent,
  type Bounds,
  type Guide,
  type Polygon,
  type Span,
  type State,
} from "../model";

export interface MagnetOptions {
  readonly targets: (context: Context) => Iterable<Polygon>;
  readonly distance?: number;
  readonly onSnap?: (guides: readonly Guide[]) => void;
}

type Axis = "x" | "y";

interface Line {
  readonly value: number;
  readonly box: Bounds;
}

interface Pair {
  readonly before: Bounds;
  readonly after: Bounds;
  readonly gap: number;
  readonly shared: Span;
}

interface Layout {
  readonly lines: Readonly<Record<Axis, readonly Line[]>>;
  readonly pairs: Readonly<Record<Axis, readonly Pair[]>>;
}

const empty: Layout = { lines: { x: [], y: [] }, pairs: { x: [], y: [] } };

const along = (box: Bounds, axis: Axis): Span =>
  axis === "x"
    ? { min: box.left, max: box.right }
    : { min: box.top, max: box.bottom };

const across = (box: Bounds, axis: Axis): Span =>
  axis === "x"
    ? { min: box.top, max: box.bottom }
    : { min: box.left, max: box.right };

const point = (axis: Axis, value: number, cross: number): Point<2> =>
  axis === "x" ? { x: value, y: cross } : { x: cross, y: value };

const middle = ({ min, max }: Span): number => (min + max) / 2;

const length = ({ min, max }: Span): number => max - min;

const marks = (span: Span): number[] => [span.min, middle(span), span.max];

const near = (left: number, right: number): boolean =>
  Math.abs(left - right) <= epsilon;

function overlap(left: Span, right: Span): Span | undefined {
  const min = Math.max(left.min, right.min);
  const max = Math.min(left.max, right.max);
  return min < max ? { min, max } : undefined;
}

const scale = ([a, b, c, d]: Matrix<2, "affine">): number =>
  Math.sqrt(Math.abs(a * d - b * c));

function nearest(offsets: Iterable<number>, reach: number): number | undefined {
  let best: number | undefined;
  for (const offset of offsets) {
    if (Math.abs(offset) > reach) continue;
    if (best === undefined || Math.abs(offset) < Math.abs(best)) best = offset;
  }
  return best;
}

const collect = (boxes: readonly Bounds[], axis: Axis): Line[] =>
  boxes.flatMap((box) =>
    marks(along(box, axis)).map((value) => ({ value, box })),
  );

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

function offset(
  box: Bounds,
  axis: Axis,
  layout: Layout,
  reach: number,
): number {
  const span = along(box, axis);
  const aligned = marks(span).flatMap((source) =>
    layout.lines[axis].map((line) => line.value - source),
  );
  const spaced = spots(box, axis, layout.pairs[axis]).map(
    (spot) => spot - span.min,
  );
  return nearest([...aligned, ...spaced], reach) ?? 0;
}

function growth(
  { min, max }: Span,
  start: boolean,
  end: boolean,
  lines: readonly Line[],
  reach: number,
): number {
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

function shift(state: State, layout: Layout, reach: number): State {
  const box = extent(corners(state));
  const x = offset(box, "x", layout, reach);
  const y = offset(box, "y", layout, reach);
  if (x === 0 && y === 0) return state;
  return {
    ...state,
    matrix: plane.multiply(plane.translate(x, y), state.matrix),
  };
}

function stretch(
  state: State,
  origin: State,
  edges: Edges,
  layout: Layout,
  reach: number,
): State | undefined {
  const [a, b, c, d] = state.matrix;
  const upright =
    Math.abs(b) <= epsilon && Math.abs(c) <= epsilon && a > 0 && d > 0;
  if (!upright) return undefined;
  const box = extent(corners(state));
  const { x, y } = layout.lines;
  const width = growth(along(box, "x"), edges.left, edges.right, x, reach) / a;
  const height = growth(along(box, "y"), edges.top, edges.bottom, y, reach) / d;
  if (width === 0 && height === 0) return state;
  const size = {
    width: Math.max(0, state.size.width + width),
    height: Math.max(0, state.size.height + height),
  };
  return { ...state, size, matrix: pin(origin, size, edges) };
}

function snap(
  { state, origin, input, action: { freedom } }: Context,
  layout: Layout,
  reach: number,
): State | undefined {
  if (input.points.length === 0) return undefined;
  if (resizes(freedom)) {
    return stretch(state, origin, freedom.edges, layout, reach);
  }
  if (freedom.translate) return shift(state, layout, reach);
  return undefined;
}

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

function gaps(box: Bounds, axis: Axis, pairs: readonly Pair[]): Guide[] {
  const span = along(box, axis);
  const cross = across(box, axis);
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

const guides = (box: Bounds, layout: Layout): Guide[] => [
  ...aligns(box, "x", layout.lines.x),
  ...aligns(box, "y", layout.lines.y),
  ...gaps(box, "x", layout.pairs.x),
  ...gaps(box, "y", layout.pairs.y),
];

const key = (guides: readonly Guide[]): string =>
  guides
    .map(({ kind, from, to }) => `${kind}${from.x},${from.y},${to.x},${to.y}`)
    .join();

export function magnet({
  targets,
  distance = 5,
  onSnap,
}: MagnetOptions): Plugin {
  let layout = empty;
  let shown = "";
  const show = (next: readonly Guide[]) => {
    if (key(next) === shown) return;
    shown = key(next);
    onSnap?.(next);
  };
  return {
    onStart: (context) => {
      const boxes = [...targets(context)].map(extent);
      layout = {
        lines: { x: collect(boxes, "x"), y: collect(boxes, "y") },
        pairs: { x: neighbors(boxes, "x"), y: neighbors(boxes, "y") },
      };
    },
    onMove: (context) => {
      const next = snap(context, layout, distance * scale(context.frame));
      show(next ? guides(extent(corners(next)), layout) : []);
      return next;
    },
    onEnd: () => show([]),
    onCancel: () => show([]),
  };
}

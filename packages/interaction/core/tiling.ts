export interface Tile {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fixed?: boolean;
}

export type Layout<K> = ReadonlyMap<K, Tile>;

export interface Tiling {
  readonly columns: number;
  readonly rows?: number;
  readonly compact?: "vertical" | "horizontal" | "none";
  readonly collision?: "push" | "block" | "overlap";
}

type Axis = "x" | "y";

const start = (tile: Tile, axis: Axis): number =>
  axis === "x" ? tile.x : tile.y;

const length = (tile: Tile, axis: Axis): number =>
  axis === "x" ? tile.width : tile.height;

const end = (tile: Tile, axis: Axis): number =>
  start(tile, axis) + length(tile, axis);

const cross = (axis: Axis): Axis => (axis === "x" ? "y" : "x");

const moved = (tile: Tile, axis: Axis, value: number): Tile =>
  axis === "x" ? { ...tile, x: value } : { ...tile, y: value };

const flow = (tiling: Tiling): Axis =>
  tiling.compact === "horizontal" ? "x" : "y";

const collides = (left: Tile, right: Tile): boolean =>
  left.x < right.x + right.width &&
  right.x < left.x + left.width &&
  left.y < right.y + right.height &&
  right.y < left.y + left.height;

export const equal = (left: Tile, right: Tile | undefined): boolean =>
  right !== undefined &&
  left.x === right.x &&
  left.y === right.y &&
  left.width === right.width &&
  left.height === right.height;

export function same<K>(left: Layout<K>, right: Layout<K>): boolean {
  if (left.size !== right.size) return false;
  for (const [key, tile] of left) {
    if (!equal(tile, right.get(key))) return false;
  }
  return true;
}

export function bottom<K>(layout: Layout<K>): number {
  let depth = 0;
  for (const tile of layout.values()) {
    depth = Math.max(depth, tile.y + tile.height);
  }
  return depth;
}

function clamp(tile: Tile, columns: number): Tile {
  const width = Math.min(Math.max(1, tile.width), columns);
  return {
    ...tile,
    width,
    height: Math.max(1, tile.height),
    x: Math.min(Math.max(0, tile.x), columns - width),
    y: Math.max(0, tile.y),
  };
}

function rise(tile: Tile, placed: readonly Tile[], axis: Axis): Tile {
  const side = cross(axis);
  let floor = 0;
  for (const other of placed) {
    const beside =
      start(other, side) < end(tile, side) &&
      start(tile, side) < end(other, side);
    if (beside && end(other, axis) <= start(tile, axis)) {
      floor = Math.max(floor, end(other, axis));
    }
  }
  return moved(tile, axis, floor);
}

function sink(
  tile: Tile,
  placed: readonly Tile[],
  axis: Axis,
  columns: number,
): Tile {
  let current = tile;
  let blocker = placed.find((other) => collides(current, other));
  while (blocker) {
    current = moved(current, axis, end(blocker, axis));
    if (axis === "x" && current.x + current.width > columns) {
      const below = {
        ...current,
        x: columns - current.width,
        y: current.y + 1,
      };
      current = rise(below, placed, "x");
    }
    blocker = placed.find((other) => collides(current, other));
  }
  return current;
}

function order<K>(layout: Layout<K>, axis: Axis): [K, Tile][] {
  const side = cross(axis);
  return [...layout].sort(
    ([, left], [, right]) =>
      start(left, axis) - start(right, axis) ||
      start(left, side) - start(right, side),
  );
}

function ahead(
  tile: Tile,
  active: Tile,
  placed: readonly Tile[],
  axis: Axis,
): Tile {
  const front = moved(tile, axis, start(active, axis) - length(tile, axis));
  const free =
    start(front, axis) >= 0 && !placed.some((other) => collides(front, other));
  return free ? front : tile;
}

function push<K>(
  layout: Layout<K>,
  key: K,
  from: Tile,
  tile: Tile,
  tiling: Tiling,
): Layout<K> {
  const axis = flow(tiling);
  const result = new Map(layout).set(key, tile);
  const placed = [tile, ...[...layout.values()].filter((other) => other.fixed)];
  for (const [other, current] of order(layout, axis)) {
    if (other === key || current.fixed) continue;
    const swap =
      tiling.compact !== "none" &&
      collides(current, tile) &&
      start(from, axis) < start(current, axis);
    const next = sink(
      swap ? ahead(current, tile, placed, axis) : current,
      placed,
      axis,
      tiling.columns,
    );
    placed.push(next);
    result.set(other, next);
  }
  return result;
}

export function settle<K>(layout: Layout<K>, tiling: Tiling): Layout<K> {
  if (tiling.collision === "overlap") return layout;
  const axis = flow(tiling);
  const result = new Map(layout);
  const placed = [...layout.values()].filter((tile) => tile.fixed);
  for (const [key, tile] of order(layout, axis)) {
    if (tile.fixed) continue;
    const bounded = clamp(tile, tiling.columns);
    const lifted =
      tiling.compact === "none" ? bounded : rise(bounded, placed, axis);
    const next = sink(lifted, placed, axis, tiling.columns);
    placed.push(next);
    result.set(key, next);
  }
  return result;
}

export function place<K>(
  layout: Layout<K>,
  key: K,
  target: Tile,
  tiling: Tiling,
): Layout<K> | undefined {
  const from = layout.get(key);
  if (!from || from.fixed) return undefined;
  const tile = clamp(target, tiling.columns);
  const others = [...layout].flatMap(([other, current]) =>
    other === key ? [] : [current],
  );
  if (others.some((other) => other.fixed && collides(tile, other))) {
    return undefined;
  }
  const collision = tiling.collision ?? "push";
  if (collision === "block" && others.some((other) => collides(tile, other))) {
    return undefined;
  }
  const next =
    collision === "push"
      ? push(layout, key, from, tile, tiling)
      : new Map(layout).set(key, tile);
  const result = settle(next, tiling);
  const within = tiling.rows === undefined || bottom(result) <= tiling.rows;
  return within ? result : undefined;
}

export function vacant<K>(
  layout: Layout<K>,
  width: number,
  height: number,
  columns: number,
): Tile {
  const size = clamp({ x: 0, y: 0, width, height }, columns);
  const tiles = [...layout.values()];
  const depth = bottom(layout);
  for (let y = 0; y < depth; y += 1) {
    for (let x = 0; x + size.width <= columns; x += 1) {
      const tile = { ...size, x, y };
      if (!tiles.some((other) => collides(tile, other))) return tile;
    }
  }
  return { ...size, x: 0, y: depth };
}

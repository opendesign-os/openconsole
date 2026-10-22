/**
 * @file 磁贴布局引擎：网格坐标里的放置、推开、紧凑与找空位，不涉及 DOM。
 *
 * 坐标以格为单位：`x`、`width` 按列，`y`、`height` 按行，左上为原点。竖直紧凑时沿 y 轴向上浮，
 * 水平紧凑时沿 x 轴向左移，越过右边界时换到下一行。
 *
 * 对外提供 {@link settle}（整理）、{@link place}（放置并安排其余磁贴）、{@link vacant}（找空位）
 * 与 {@link bottom}、{@link same}、{@link equal} 等查询；全部是纯函数，返回新布局而不修改传入的布局。
 */

/** 一块磁贴在网格里的位置与尺寸，单位为格。 */
export interface Tile {
  /** 起始列，从 0 开始。 */
  readonly x: number;
  /** 起始行，从 0 开始。 */
  readonly y: number;
  /** 占用列数，至少 1。 */
  readonly width: number;
  /** 占用行数，至少 1。 */
  readonly height: number;
  /**
   * 固定磁贴：不可拖动，不会被推开，也不参与紧凑。
   *
   * @default false
   */
  readonly fixed?: boolean;
}

/**
 * 布局：每个键对应一块磁贴。
 *
 * @template K 键类型，通常是磁贴元素。
 */
export type Layout<K> = ReadonlyMap<K, Tile>;

/** 布局规则。 */
export interface Tiling {
  /** 列数，正整数；磁贴的宽度与起始列都被夹在其内。 */
  readonly columns: number;
  /** 行数上限；结果超出时 {@link place} 拒绝本次移动。缺省不限。 */
  readonly rows?: number;
  /**
   * 紧凑方向：`"vertical"` 向上浮，`"horizontal"` 向左移，`"none"` 不紧凑、只在重叠时推开。
   *
   * @default "vertical"
   */
  readonly compact?: "vertical" | "horizontal" | "none";
  /**
   * 碰撞处理：`"push"` 推开挡路的磁贴，`"block"` 有重叠就拒绝移动，`"overlap"` 允许重叠。
   *
   * @default "push"
   */
  readonly collision?: "push" | "block" | "overlap";
}

/** 坐标轴：`"x"` 为列方向，`"y"` 为行方向。 */
type Axis = "x" | "y";

/**
 * 取磁贴在某轴上的起点。
 *
 * @param tile 磁贴。
 * @param axis 坐标轴。
 * @returns `x` 或 `y`。
 */
const start = (tile: Tile, axis: Axis): number =>
  axis === "x" ? tile.x : tile.y;

/**
 * 取磁贴在某轴上的长度。
 *
 * @param tile 磁贴。
 * @param axis 坐标轴。
 * @returns `width` 或 `height`。
 */
const length = (tile: Tile, axis: Axis): number =>
  axis === "x" ? tile.width : tile.height;

/**
 * 取磁贴在某轴上的终点（不含）。
 *
 * @param tile 磁贴。
 * @param axis 坐标轴。
 * @returns 起点加长度。
 */
const end = (tile: Tile, axis: Axis): number =>
  start(tile, axis) + length(tile, axis);

/**
 * 取另一条轴。
 *
 * @param axis 坐标轴。
 * @returns 与 `axis` 垂直的轴。
 */
const cross = (axis: Axis): Axis => (axis === "x" ? "y" : "x");

/**
 * 沿某轴移到指定起点，另一条轴与尺寸不变。
 *
 * @param tile 磁贴。
 * @param axis 移动所沿的轴。
 * @param value 新的起点。
 * @returns 移动后的新磁贴。
 */
const moved = (tile: Tile, axis: Axis, value: number): Tile =>
  axis === "x" ? { ...tile, x: value } : { ...tile, y: value };

/**
 * 求紧凑与推开所沿的轴：水平紧凑为 x，其余（含 `"none"`）为 y。
 *
 * @param tiling 布局规则。
 * @returns 紧凑轴。
 */
const flow = (tiling: Tiling): Axis =>
  tiling.compact === "horizontal" ? "x" : "y";

/**
 * 判断两块磁贴是否重叠；只有边相接不算。
 *
 * @param left 磁贴。
 * @param right 另一块磁贴。
 * @returns 两条轴上的区间都有正长度的交集时为 `true`。
 */
const collides = (left: Tile, right: Tile): boolean =>
  left.x < right.x + right.width &&
  right.x < left.x + left.width &&
  left.y < right.y + right.height &&
  right.y < left.y + left.height;

/**
 * 判断两块磁贴的位置与尺寸是否相同，忽略 `fixed`。
 *
 * @param left 磁贴。
 * @param right 另一块磁贴，可为空。
 * @returns 相同时为 `true`；`right` 为空时为 `false`。
 */
export const equal = (left: Tile, right: Tile | undefined): boolean =>
  right !== undefined &&
  left.x === right.x &&
  left.y === right.y &&
  left.width === right.width &&
  left.height === right.height;

/**
 * 判断两个布局是否相同：键相同，且每块磁贴的位置与尺寸都相同。
 *
 * 用于跳过没有变化的重排与通知；与键的插入顺序无关。
 *
 * @template K 键类型。
 * @param left 布局。
 * @param right 另一个布局。
 * @returns 相同时为 `true`。
 */
export function same<K>(left: Layout<K>, right: Layout<K>): boolean {
  if (left.size !== right.size) return false;
  for (const [key, tile] of left) {
    if (!equal(tile, right.get(key))) return false;
  }
  return true;
}

/**
 * 求布局占用的总行数，即最下面一块磁贴的下沿。
 *
 * @template K 键类型。
 * @param layout 布局。
 * @returns 总行数；空布局为 0。
 * @example
 * bottom(new Map([["a", { x: 0, y: 2, width: 3, height: 3 }]])); // 5
 */
export function bottom<K>(layout: Layout<K>): number {
  let depth = 0;
  for (const tile of layout.values()) {
    depth = Math.max(depth, tile.y + tile.height);
  }
  return depth;
}

/**
 * 把磁贴限制在网格里：宽 1~columns，高至少 1，不越过左、右、上边界。
 *
 * 下边界不限，行数上限由 {@link place} 在整理后检查。
 *
 * @param tile 磁贴。
 * @param columns 网格列数。
 * @returns 夹好的新磁贴，`fixed` 等其余字段保留。
 */
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

/**
 * 紧凑：沿轴移到前方最近的阻挡之后。
 *
 * 阻挡指已放好、在另一条轴上与它有重叠、且整个位于它前方的磁贴；没有阻挡时移到 0。
 * 只会向前（朝 0）移动；移动后若与别的磁贴重叠，由 {@link sink} 再推开。
 *
 * @param tile 要紧凑的磁贴。
 * @param placed 已放好的磁贴。
 * @param axis 紧凑轴。
 * @returns 紧凑后的新磁贴。
 */
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

/**
 * 推开：与已放好的磁贴重叠时，沿轴挪到挡路磁贴之后，直到不再重叠。
 *
 * 水平方向越过右边界时，换到下一行最右侧的位置再向左紧凑，继续检查重叠。
 * 每次都移到挡路磁贴的终点（换行时行号加一），所以有限步内必然停下。
 *
 * @param tile 要安放的磁贴。
 * @param placed 已放好的磁贴，不会移动。
 * @param axis 推开所沿的轴。
 * @param columns 网格列数，只在沿 x 轴推开时用来换行。
 * @returns 与 `placed` 都不重叠的新磁贴。
 */
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

/**
 * 求处理顺序：先按紧凑轴上的起点，再按另一条轴；靠前的先放，后面的据此让位。
 *
 * @template K 键类型。
 * @param layout 布局。
 * @param axis 紧凑轴。
 * @returns 排好序的 `[键, 磁贴]` 列表；起点都相同时保持原顺序。
 */
function order<K>(layout: Layout<K>, axis: Axis): [K, Tile][] {
  const side = cross(axis);
  return [...layout].sort(
    ([, left], [, right]) =>
      start(left, axis) - start(right, axis) ||
      start(left, side) - start(right, side),
  );
}

/**
 * 交换：把 `tile` 挪到被拖磁贴 `active` 的前方，紧贴它的起点。
 *
 * 前方越界或与已放好的磁贴重叠时保持原位，随后由 {@link sink} 推到后面。
 *
 * @param tile 让位的磁贴。
 * @param active 被拖磁贴的目标位置。
 * @param placed 已放好的磁贴。
 * @param axis 紧凑轴。
 * @returns 挪到前方的新磁贴；挪不开时为原磁贴。
 */
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

/**
 * 推开模式的放置：被拖磁贴先占住目标格，其余磁贴按 {@link order} 依次处理。
 *
 * 与目标重叠、且被拖磁贴是从它前方移来的（交换规则），先尝试让到被拖磁贴之前；
 * 让不开或不满足条件时推到后面。固定磁贴原地不动，并当作阻挡。
 * 不紧凑（`compact` 为 `"none"`）时不交换，只推开。
 *
 * @template K 键类型。
 * @param layout 当前布局。
 * @param key 被拖磁贴的键。
 * @param from 被拖磁贴移动前的位置，用来判断是否满足交换规则。
 * @param tile 被拖磁贴的目标位置，已夹进网格。
 * @param tiling 布局规则。
 * @returns 新布局，被拖磁贴位于 `tile`；尚未整理。
 */
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

/**
 * 整理布局：固定磁贴原地不动，其余按顺序夹进网格、紧凑（`compact` 为 `"none"` 时跳过）、
 * 再推开仍然重叠的。`collision` 为 `"overlap"` 时原样返回。
 *
 * 适合在初始化、增删磁贴或改变列数后调用，把任意输入整理成合法布局。
 *
 * @template K 键类型。
 * @param layout 布局。
 * @param tiling 布局规则。
 * @returns 整理后的新布局；不修改传入的布局。`collision` 为 `"overlap"` 时即传入的布局。
 * @example
 * settle(new Map([["a", { x: 0, y: 3, width: 2, height: 1 }]]), { columns: 6 });
 * // a 上浮到 { x: 0, y: 0 }
 */
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

/**
 * 把一块磁贴放到目标位置（可同时改尺寸），按碰撞规则安排其余磁贴，再整理布局。
 *
 * 拖动时以当前预览为基准逐步调用，所以拖过多块磁贴时会依次交换。
 * 整理后被拖磁贴也可能紧凑到别处，例如竖直紧凑时放到空处会上浮。
 *
 * @template K 键类型。
 * @param layout 当前布局。
 * @param key 要移动的磁贴的键。
 * @param target 目标位置与尺寸，会先被夹进网格。
 * @param tiling 布局规则。
 * @returns 新布局。以下情况为 `undefined`：键不存在或是固定磁贴；目标与固定磁贴重叠；
 *   `collision` 为 `"block"` 且目标与任一磁贴重叠；结果超出 `rows`。
 * @example
 * const current = layout.get(item);
 * const next = current && place(layout, item, { ...current, x: 2 }, { columns: 12 });
 * if (next) layout = next;
 */
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

/**
 * 找空位：从上到下、从左到右找第一个放得下 `width × height` 的位置。
 *
 * 逐格扫描现有的行，复杂度约为 O(行数 × 列数 × 磁贴数)。
 *
 * @template K 键类型。
 * @param layout 当前布局。
 * @param width 列数，会被夹进 1~columns。
 * @param height 行数，至少 1。
 * @param columns 网格列数。
 * @returns 空位上的磁贴；现有行里放不下时放在最下方新起一行。
 * @example
 * const layout = new Map([["a", { x: 0, y: 0, width: 6, height: 2 }]]);
 * vacant(layout, 4, 2, 12); // { x: 6, y: 0, width: 4, height: 2 }
 */
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

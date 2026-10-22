/**
 * @file 碰撞插件：被拖元素不与障碍物重叠。
 *
 * 元素与障碍物都是容器空间里的凸多边形，用分离轴定理（SAT）判断重叠。平移时做扫掠求首次接触，
 * 停在接触处并沿障碍物表面滑动；旋转、缩放与调整尺寸沿动作路径二分逼近，停在接触前。
 */

import { plane, type Point } from "@openconsole/matrix";

import { pin, resizes, type Context, type Edges, type Plugin } from "../core";
import {
  corners,
  epsilon,
  type Polygon,
  type Span,
  type State,
} from "../model";

/** 扫掠的首次接触。 */
interface Hit {
  /** 接触时刻，为这一步位移的比例，取值 `[0, 1)`。 */
  readonly time: number;
  /** 接触面的单位法线，背向位移方向，从障碍物指向被拖元素。 */
  readonly normal: Point<2>;
}

/**
 * 两个向量的点积。
 *
 * @param left 左向量。
 * @param right 右向量。
 * @returns `left·right`；`right` 为单位向量时即 `left` 在其方向上的投影长度。
 */
const dot = (left: Point<2>, right: Point<2>): number =>
  left.x * right.x + left.y * right.y;

/**
 * 向量数乘。
 *
 * @param vector 向量。
 * @param factor 系数。
 * @returns 新向量 `vector·factor`。
 */
const times = (vector: Point<2>, factor: number): Point<2> => ({
  x: vector.x * factor,
  y: vector.y * factor,
});

/**
 * 去掉 `vector` 沿单位法线 `normal` 的分量，得到沿接触面的切向分量。
 *
 * @param vector 剩余位移。
 * @param normal 接触面的单位法线。
 * @returns 切向分量，即 `vector − (vector·normal)·normal`。
 */
function tangent(vector: Point<2>, normal: Point<2>): Point<2> {
  const depth = dot(vector, normal);
  return { x: vector.x - depth * normal.x, y: vector.y - depth * normal.y };
}

/**
 * 线性插值。
 *
 * @param from 起点值，`ratio` 为 0 时取它。
 * @param to 终点值，`ratio` 为 1 时取它。
 * @param ratio 比例。
 * @returns `from + (to − from)·ratio`。
 */
const mix = (from: number, to: number, ratio: number): number =>
  from + (to - from) * ratio;

/**
 * 多边形各条边的单位法线，作为分离轴；零长的边跳过。
 *
 * 法线由边向量 `(dx, dy)` 转成 `(dy, −dx)` 再归一化；SAT 只关心轴的方向，与顶点顺时针还是逆时针无关。
 *
 * @param polygon 凸多边形。
 * @returns 每条非零长边一条单位法线。
 */
function normals(polygon: Polygon): Point<2>[] {
  return polygon.flatMap((start, index) => {
    const end = polygon[(index + 1) % polygon.length] ?? start;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length === 0) return [];
    return [{ x: (end.y - start.y) / length, y: (start.x - end.x) / length }];
  });
}

/**
 * SAT 需要检查的全部分离轴：两个多边形所有边的法线。
 *
 * @param shape 被拖元素的多边形。
 * @param obstacle 障碍物。
 * @returns 两者全部边的单位法线，可能有重复方向。
 */
const axes = (shape: Polygon, obstacle: Polygon): Point<2>[] => [
  ...normals(shape),
  ...normals(obstacle),
];

/**
 * 多边形在轴上的投影区间。
 *
 * @param polygon 多边形。
 * @param axis 单位轴向量。
 * @returns 各顶点投影的最小值与最大值。
 */
function project(polygon: Polygon, axis: Point<2>): Span {
  const values = polygon.map((point) => dot(point, axis));
  return { min: Math.min(...values), max: Math.max(...values) };
}

/**
 * 两个投影区间是否分离；恰好接触也算分离（留 `epsilon` 容差），贴边移动不会被判为重叠。
 *
 * @param moving 被拖元素的投影区间。
 * @param fixed 障碍物的投影区间。
 * @returns 两区间不相交或只在容差内接触时为 `true`。
 */
const separated = (moving: Span, fixed: Span): boolean =>
  moving.max <= fixed.min + epsilon || fixed.max <= moving.min + epsilon;

/**
 * 分离轴定理：所有分离轴上的投影都相交时，两个凸多边形才重叠。
 *
 * @param shape 被拖元素的多边形。
 * @param obstacle 障碍物。
 * @returns 重叠时为 `true`；分离、只接触或两者都没有非零长的边时为 `false`。
 */
function overlaps(shape: Polygon, obstacle: Polygon): boolean {
  const directions = axes(shape, obstacle);
  return (
    directions.length > 0 &&
    directions.every(
      (axis) => !separated(project(shape, axis), project(obstacle, axis)),
    )
  );
}

/**
 * 连续碰撞检测：形状沿 `motion` 平移时与障碍物首次接触的时刻。
 *
 * 在每条分离轴上求投影开始相交（进入）与不再相交（离开）的时刻，进入取各轴最大值、离开取最小值；
 * 进入不晚于离开且落在这一步之内即为碰撞，法线取最后进入的那条轴。位移与某轴垂直时，
 * 若该轴上已经分离，整段都不会相撞。
 *
 * @param shape 被拖元素当前的四个角。
 * @param motion 这一步的平移（容器空间）。
 * @param obstacle 障碍物。
 * @returns 首次接触；整段都不相撞时为 `undefined`。
 */
function sweep(
  shape: Polygon,
  motion: Point<2>,
  obstacle: Polygon,
): Hit | undefined {
  let enter = -Infinity;
  let exit = Infinity;
  let normal: Point<2> | undefined;
  for (const axis of axes(shape, obstacle)) {
    const moving = project(shape, axis);
    const fixed = project(obstacle, axis);
    const speed = dot(motion, axis);
    if (Math.abs(speed) < epsilon) {
      if (separated(moving, fixed)) return undefined;
      continue;
    }
    const near = speed > 0 ? fixed.min - moving.max : fixed.max - moving.min;
    const far = speed > 0 ? fixed.max - moving.min : fixed.min - moving.max;
    if (near / speed > enter) {
      enter = near / speed;
      normal = speed > 0 ? times(axis, -1) : axis;
    }
    exit = Math.min(exit, far / speed);
  }
  if (!normal || enter > exit || enter >= 1 || exit <= 0) return undefined;
  return { time: Math.max(0, enter), normal };
}

/**
 * 所有障碍物里最早的一次接触。
 *
 * @param shape 被拖元素当前的四个角。
 * @param motion 这一步的平移（容器空间）。
 * @param obstacles 障碍物。
 * @returns 时刻最小的接触；与所有障碍物都不相撞时为 `undefined`。
 */
function earliest(
  shape: Polygon,
  motion: Point<2>,
  obstacles: readonly Polygon[],
): Hit | undefined {
  let first: Hit | undefined;
  for (const obstacle of obstacles) {
    const hit = sweep(shape, motion, obstacle);
    if (hit && (!first || hit.time < first.time)) first = hit;
  }
  return first;
}

/**
 * 两个状态若只差平移（线性部分与尺寸都没变），返回平移向量。
 *
 * @param from 上一步的状态。
 * @param to 候选状态。
 * @returns 容器空间里的平移；有旋转、缩放或尺寸变化时为 `undefined`。
 */
function translation(from: State, to: State): Point<2> | undefined {
  const turned = !plane.equals(
    plane.linear(from.matrix),
    plane.linear(to.matrix),
    epsilon,
  );
  const resized =
    from.size.width !== to.size.width || from.size.height !== to.size.height;
  if (turned || resized) return undefined;
  return { x: to.matrix[4] - from.matrix[4], y: to.matrix[5] - from.matrix[5] };
}

/**
 * 移动并滑动（move and slide）：从 `state` 沿 `motion` 平移，碰到障碍物就停在接触处，
 * 把剩余位移去掉法向分量后沿表面继续走。最多迭代三次，足以处理夹角里的连续接触，又不会来回抖动。
 *
 * @param state 起点状态，即上一步的位置。
 * @param motion 这一步的平移（容器空间）。
 * @param obstacles 障碍物。
 * @returns 滑动后的状态。
 */
function slide(
  state: State,
  motion: Point<2>,
  obstacles: readonly Polygon[],
): State {
  let current = state;
  let rest = motion;
  for (let step = 0; step < 3; step += 1) {
    if (Math.hypot(rest.x, rest.y) <= epsilon) break;
    const hit = earliest(corners(current), rest, obstacles);
    const time = hit?.time ?? 1;
    const travel = times(rest, time);
    current = {
      ...current,
      matrix: plane.multiply(
        plane.translate(travel.x, travel.y),
        current.matrix,
      ),
    };
    if (!hit) break;
    rest = tangent(times(rest, 1 - time), hit.normal);
  }
  return current;
}

/** 动作路径：`ratio` 从 0 到 1 时，由上一步的状态过渡到候选状态。 */
type Path = (ratio: number) => State;

/**
 * 调整尺寸的路径：宽高线性插值，按会话起点钉住对边，与动作的钉住方式一致。
 *
 * @param from 上一步的状态。
 * @param to 候选状态。
 * @param origin 会话起点。
 * @param edges 移动的边。
 * @returns 沿尺寸插值的路径。
 */
function grow(from: State, to: State, origin: State, edges: Edges): Path {
  return (ratio) => {
    const size = {
      width: mix(from.size.width, to.size.width, ratio),
      height: mix(from.size.height, to.size.height, ratio),
    };
    return { ...to, size, matrix: pin(origin, size, edges) };
  };
}

/**
 * 旋转、缩放的路径。
 *
 * 两步之差 `to·from⁻¹` 若是相似变换（`a = d`、`b = −c`），解出它的不动点作为中心，
 * 绕该点按比例插值角度、按指数插值缩放，元素沿真实的转动轨迹运动。
 *
 * @param from 上一步的状态。
 * @param to 候选状态。
 * @returns 绕不动点的路径；`from.matrix` 不可逆或两步之差不是相似变换时为 `undefined`。
 */
function turn(from: State, to: State): Path | undefined {
  const inverse = plane.invert(from.matrix);
  if (!inverse) return undefined;
  const [a, b, c, d, e, f] = plane.multiply(to.matrix, inverse);
  if (Math.abs(a - d) > epsilon || Math.abs(b + c) > epsilon) return undefined;
  const angle = Math.atan2(b, a);
  const factor = Math.hypot(a, b);
  const determinant = (1 - a) * (1 - d) - b * c;
  const pivot = {
    x: ((1 - d) * e + c * f) / determinant,
    y: ((1 - a) * f + b * e) / determinant,
  };
  return (ratio) => ({
    ...to,
    matrix: plane.multiply(
      plane.around(
        pivot,
        plane.multiply(
          plane.rotate(angle * ratio),
          plane.scale(factor ** ratio),
        ),
      ),
      from.matrix,
    ),
  });
}

/**
 * 沿路径二分查找最后一个不重叠的位置；起点（上一步）不重叠，迭代 32 次。
 *
 * @param path 动作路径。
 * @param blocked 判断状态是否与障碍物重叠。
 * @returns 接触前一刻的状态。
 */
function advance(path: Path, blocked: (state: State) => boolean): State {
  let low = 0;
  let high = 1;
  for (let step = 0; step < 32; step += 1) {
    const middle = (low + high) / 2;
    if (blocked(path(middle))) high = middle;
    else low = middle;
  }
  return path(low);
}

/**
 * 创建碰撞插件：被拖元素不与 `targets` 返回的障碍物重叠。
 *
 * - 会话开始时取一次障碍物；开始时就与元素重叠的障碍物被忽略，例如元素的祖先或它正压着的同伴，
 *   否则元素一步也动不了。
 * - 这一步只有平移：从上一步沿位移扫掠，停在首次接触处并沿障碍物表面滑动，快速拖动也不会穿过。
 * - 有旋转、缩放或尺寸变化：候选与障碍物重叠时，沿「上一步 → 候选」的路径二分，停在接触前；
 *   构造不出路径时退回上一步。
 *
 * 能力组合里它排在最后，所以吸附、范围与上下限之后的结果也不重叠。
 *
 * @param targets 返回障碍物的函数，每次会话开始时调用一次；障碍物须是容器空间里的凸多边形。
 * @returns 实现 `onStart` 与 `onMove` 的插件。
 * @example
 * bind(node, {
 *   action: transform({ translate: true }),
 *   plugins: [collide(outlines(node, ".card", board))],
 * });
 */
export function collide(
  targets: (context: Context) => Iterable<Polygon>,
): Plugin {
  /** 本次会话的障碍物，已去掉开始时就重叠的。 */
  let obstacles: Polygon[] = [];
  /** 状态的四个角是否与任一障碍物重叠。 */
  const blocked = (state: State) => {
    const shape = corners(state);
    return obstacles.some((obstacle) => overlaps(shape, obstacle));
  };
  return {
    /** 取本次会话的障碍物，忽略开始时就与元素重叠的。 */
    onStart: (context) => {
      const shape = corners(context.state);
      obstacles = [...targets(context)].filter(
        (obstacle) => !overlaps(shape, obstacle),
      );
    },
    /** 纯平移时扫掠并滑动；其余变化重叠时沿路径二分，构造不出路径则退回上一步。 */
    onMove: ({ state, previous, origin, action: { freedom } }) => {
      if (obstacles.length === 0) return undefined;
      const motion = translation(previous, state);
      if (motion) {
        return slide({ ...state, matrix: previous.matrix }, motion, obstacles);
      }
      if (!blocked(state)) return undefined;
      const path = resizes(freedom)
        ? grow(previous, state, origin, freedom.edges)
        : turn(previous, state);
      if (path) return advance(path, blocked);
      return { ...state, matrix: previous.matrix, size: previous.size };
    },
  };
}

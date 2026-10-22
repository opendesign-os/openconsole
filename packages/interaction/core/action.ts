/**
 * @file 动作：把输入点的移动换算成新的 {@link State}，并声明自由度。
 *
 * 动作只负责按自由度求解，约束交给插件。传入的点都已经由 frame 换到容器空间
 * （offsetParent 内边距盒，左上为原点），所以祖先带旋转、斜切、缩放时同样跟手。
 */

import { plane, type Matrix, type Point } from "@openconsole/matrix";

import { centroid, type Size, type State } from "../model";

/** 调整尺寸时会移动的局部边；同一对边都为 `true` 表示两侧对称调整。 */
export interface Edges {
  /** 左边会移动。 */
  readonly left: boolean;
  /** 上边会移动。 */
  readonly top: boolean;
  /** 右边会移动。 */
  readonly right: boolean;
  /** 下边会移动。 */
  readonly bottom: boolean;
}

/**
 * 动作声明的自由度。
 *
 * 内置插件只看自由度、不看动作种类，所以自定义动作同样适用：能平移就吸附或推回平移量，
 * 有边会移动就处理尺寸，能缩放就夹住缩放。
 */
export interface Freedom {
  /** 允许平移。 */
  readonly translate: boolean;
  /** 允许旋转。 */
  readonly rotate: boolean;
  /** 允许等比缩放；非等比的变化由 `size` 表达。 */
  readonly scale: boolean;
  /** 调整尺寸时移动的边；全为 `false` 表示不改尺寸。 */
  readonly edges: Edges;
  /** 不允许平移时，旋转、缩放保持不动的点（局部空间）。缺省为边框盒中心。 */
  readonly pivot?: Point<2>;
}

/**
 * 动作：由起止输入点求出新状态，并声明自由度。
 *
 * 由 {@link Tracker} 每帧调用。`origin` 是本段的段基准，`from` 是段起点时的输入点，
 * `to` 是当前输入点；每帧都从段基准整体求解而不是逐事件累加，避免误差累积，
 * 也避免约束（夹边、碰撞）丢掉的位移让元素脱离指针。
 */
export interface Action {
  /** 本动作的自由度，插件据此决定行为。 */
  readonly freedom: Freedom;
  /**
   * 求解新状态。
   *
   * @param origin 段基准状态。
   * @param from 段起点时的输入点（容器空间）。
   * @param to 当前输入点（容器空间），点数与 `from` 相同。
   * @returns 未经约束的候选状态；点数不足或前后不一致时原样返回 `origin`。
   */
  solve(
    origin: State,
    from: readonly Point<2>[],
    to: readonly Point<2>[],
  ): State;
}

/**
 * 调整尺寸的手柄方位。`x`、`y` 取 -1、0、1，分别表示左（上）边、不动、右（下）边。
 * 例如右下角为 `{ x: 1, y: 1 }`，右边中点为 `{ x: 1, y: 0 }`。
 */
export interface Handle {
  /** 水平方位：-1 左边，0 不动，1 右边。 */
  readonly x: -1 | 0 | 1;
  /** 垂直方位：-1 上边，0 不动，1 下边。 */
  readonly y: -1 | 0 | 1;
}

/** 不改尺寸的动作使用的边集合。 */
const none: Edges = { left: false, top: false, right: false, bottom: false };

/**
 * 判断自由度是否会调整尺寸。
 *
 * @param freedom 动作的自由度。
 * @returns 有任一边会移动时为 `true`。
 */
export const resizes = ({ edges }: Freedom): boolean =>
  edges.left || edges.top || edges.right || edges.bottom;

/**
 * 求旋转、缩放保持不动的锚点（容器空间）。
 *
 * 允许平移时取输入点的质心，两指手势因此绕手指中心变换；否则取支点，缺省为边框盒中心。
 *
 * @param freedom 动作的自由度。
 * @param state 段基准状态，用来把局部支点换到容器空间。
 * @param points 段起点时的输入点（容器空间）。
 * @returns 锚点（容器空间）。
 */
export function anchor(
  freedom: Freedom,
  state: State,
  points: readonly Point<2>[],
): Point<2> {
  if (freedom.translate && points.length > 0) return centroid(points);
  const { width, height } = state.size;
  return plane.apply(
    state.matrix,
    freedom.pivot ?? { x: width / 2, y: height / 2 },
  );
}

/**
 * 钉住对边：尺寸从 `origin.size` 变为 `size` 时，求让不动的边保持原位的状态矩阵。
 *
 * 在局部空间里平移 `f·(w₀ − w)`、`f·(h₀ − h)`：只动右（下）边时 f = 0，左上不动；
 * 只动左（上）边时 f = 1，右下不动；两侧都动（对称）时 f = ½，中心不动。
 * 平移发生在局部空间，所以节点旋转后同样成立。
 *
 * @param origin 段基准状态，提供原尺寸与原矩阵。
 * @param size 新尺寸。
 * @param edges 会移动的边。
 * @returns 新的状态矩阵（局部空间 → 容器空间）。
 */
export function pin(
  origin: State,
  size: Size,
  edges: Edges,
): Matrix<2, "affine"> {
  const share = (low: boolean, high: boolean) => (low ? (high ? 0.5 : 1) : 0);
  return plane.multiply(
    origin.matrix,
    plane.translate(
      share(edges.left, edges.right) * (origin.size.width - size.width),
      share(edges.top, edges.bottom) * (origin.size.height - size.height),
    ),
  );
}

/**
 * 把一次相似变换投影到允许的自由度上，改写成绕锚点 a 的规范形式：
 * `G′ = T(a + τ)·R(θ)·S(k)·T(−a)`，其中 `τ = G(a) − a`，θ、k 取自 `motion` 的线性部分。
 *
 * τ、θ、k 是同一次手势同时求出的三个分量，不是先后发生的操作；不允许的分量取零
 * （τ = 0、θ = 0、k = 1），各分量互不干扰，结果与分量顺序无关。
 */
function project(
  motion: Matrix<2, "affine">,
  point: Point<2>,
  freedom: Freedom,
): Matrix<2, "affine"> {
  const [a, b] = motion;
  const target = freedom.translate ? plane.apply(motion, point) : point;
  return plane.multiply(
    plane.translate(target.x, target.y),
    plane.rotate(freedom.rotate ? Math.atan2(b, a) : 0),
    plane.scale(freedom.scale ? Math.hypot(a, b) : 1),
    plane.translate(-point.x, -point.y),
  );
}

/**
 * 创建平移、旋转、等比缩放类动作，拖拽、旋转、双指与平移缩放都用它。
 *
 * - 两个点：用 `plane.pinch` 求出把起点对映到当前点的相似变换。
 * - 一个点、允许平移：按位移平移。
 * - 一个点、不允许平移：以锚点为虚拟第一点求旋转与缩放（单指旋转）。
 *
 * 随后按自由度投影，再左乘到段基准矩阵上：`M = G′·M_base`。
 *
 * @param options 自由度开关与支点。
 * @returns 动作。
 * @example
 * transform({ translate: true }); // 拖拽
 * transform({ rotate: true, pivot: { x: 0, y: 0 } }); // 绕左上角旋转
 * transform({ translate: true, rotate: true, scale: true }); // 双指平移旋转缩放
 */
export function transform(
  options: {
    /**
     * 允许平移。
     * @default false
     */
    readonly translate?: boolean;
    /**
     * 允许旋转。
     * @default false
     */
    readonly rotate?: boolean;
    /**
     * 允许等比缩放。
     * @default false
     */
    readonly scale?: boolean;
    /** 不允许平移时的支点（局部空间），缺省为边框盒中心。 */
    readonly pivot?: Point<2>;
  } = {},
): Action {
  const { translate = false, rotate = false, scale = false, pivot } = options;
  const freedom: Freedom = {
    translate,
    rotate,
    scale,
    edges: none,
    ...(pivot ? { pivot } : {}),
  };
  return {
    freedom,
    solve(origin, from, to) {
      const [first, second] = from;
      const [last, next] = to;
      if (!first || !last || from.length !== to.length) return origin;
      const point = anchor(freedom, origin, from);
      const motion =
        second && next
          ? plane.pinch([first, second], [last, next])
          : translate
            ? plane.translate(last.x - first.x, last.y - first.y)
            : plane.pinch([point, first], [point, last]);
      return {
        ...origin,
        matrix: plane.multiply(project(motion, point, freedom), origin.matrix),
      };
    },
  };
}

/**
 * 创建调整尺寸的动作。
 *
 * 指针位移先换到局部空间（去掉旋转与缩放），再按手柄方位改宽高，随后钉住对边。
 * 对称时两侧同时移动，尺寸变化计两倍。尺寸不小于 0，其余范围交给 `limits` 插件。
 *
 * @param options 手柄方位与是否对称。
 * @returns 动作。
 * @example
 * resize({ handle: { x: 1, y: 1 } }); // 右下角，左上不动
 * resize({ handle: { x: -1, y: 0 }, symmetric: true }); // 左边，左右对称
 */
export function resize(options: {
  /** 手柄方位。 */
  readonly handle: Handle;
  /**
   * 两侧对称调整，中心不动。
   * @default false
   */
  readonly symmetric?: boolean;
}): Action {
  const { handle, symmetric = false } = options;
  /** 对称时，手柄所在的轴上两条边都会移动。 */
  const both = (side: -1 | 0 | 1) => symmetric && side !== 0;
  const edges: Edges = {
    left: handle.x === -1 || both(handle.x),
    top: handle.y === -1 || both(handle.y),
    right: handle.x === 1 || both(handle.x),
    bottom: handle.y === 1 || both(handle.y),
  };
  const factor = symmetric ? 2 : 1;
  return {
    freedom: { translate: false, rotate: false, scale: false, edges },
    solve(origin, from, to) {
      const [first] = from;
      const [last] = to;
      const inverse = plane.invert(plane.linear(origin.matrix));
      if (!first || !last || !inverse) return origin;
      const delta = plane.apply(inverse, {
        x: last.x - first.x,
        y: last.y - first.y,
      });
      const size = {
        width: Math.max(0, origin.size.width + handle.x * factor * delta.x),
        height: Math.max(0, origin.size.height + handle.y * factor * delta.y),
      };
      return { ...origin, size, matrix: pin(origin, size, edges) };
    },
  };
}

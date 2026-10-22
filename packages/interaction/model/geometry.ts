/**
 * @file 平面几何基础：区间、范围、包围盒、多边形与参考线，以及包围盒、面积、包含、裁剪等纯函数。
 *
 * 不引用 DOM；多边形顶点按顺序首尾相连，顺时针或逆时针都可以。坐标空间由调用方决定，
 * 同一次计算里的所有点必须在同一空间（例如都在容器空间，或都在屏幕坐标）。
 */

import type { Matrix, Point } from "@openconsole/matrix";

/** 闭区间 `[min, max]`。 */
export interface Span {
  /** 下界。 */
  readonly min: number;
  /** 上界。 */
  readonly max: number;
}

/** 可只给一端的范围；缺省的一端视为不限，例如 `{ min: 0 }` 表示不小于 0。 */
export type Range = Partial<Span>;

/** 轴对齐包围盒；坐标空间由使用方决定。 */
export interface Bounds {
  /** 左边 x。 */
  readonly left: number;
  /** 上边 y。 */
  readonly top: number;
  /** 右边 x。 */
  readonly right: number;
  /** 下边 y。 */
  readonly bottom: number;
}

/** 多边形：顶点按顺序首尾相连。旋转后的节点用它表达，而不是包围盒。 */
export type Polygon = readonly Point<2>[];

/** 浮点比较的容差（像素量级），用于判断「几乎相等」「几乎没有变化」。 */
export const epsilon = 1e-6;

/** 磁吸给出的参考线，端点在被拖元素的容器空间里。 */
export interface Guide {
  /** `"align"` 为对齐线，`"gap"` 为等间距的间距段。 */
  readonly kind: "align" | "gap";
  /** 起点。 */
  readonly from: Point<2>;
  /** 终点。 */
  readonly to: Point<2>;
}

/**
 * 叉积 `(end − start) × (point − start)`：判断点在有向线段的哪一侧。
 *
 * 本文件只依赖正负号是否一致，不依赖哪一侧为正。
 *
 * @param start 有向线段起点。
 * @param end 有向线段终点。
 * @param point 待测点。
 * @returns 在 y 轴向下的屏幕上，`point` 位于行进方向右手边（顺时针一侧）时为正、左手边为负、
 *   共线为 0；绝对值是三点所围平行四边形的面积。
 */
const side = (start: Point<2>, end: Point<2>, point: Point<2>): number =>
  (end.x - start.x) * (point.y - start.y) -
  (end.y - start.y) * (point.x - start.x);

/**
 * 多边形的各条边，最后一条连回起点。
 *
 * @param polygon 多边形。
 * @returns 每条边的起点与终点，条数与顶点数相同。
 */
const edges = (polygon: Polygon): [Point<2>, Point<2>][] =>
  polygon.map((start, index) => [
    start,
    polygon[(index + 1) % polygon.length] ?? start,
  ]);

/**
 * 有向面积（鞋带公式），正负反映顶点方向。
 *
 * @param polygon 简单多边形。
 * @returns 面积带符号：顶点在 y 向下的屏幕上顺时针排列时为正，逆时针为负。
 */
function signed(polygon: Polygon): number {
  let sum = 0;
  for (const [start, end] of edges(polygon)) {
    sum += start.x * end.y - end.x * start.y;
  }
  return sum / 2;
}

/**
 * 线段 `from → to` 与直线 `start → end` 的交点。
 *
 * 只在两端点一内一外时调用（至多一端恰在直线上），因此分母不为 0。
 *
 * @param from 线段起点。
 * @param to 线段终点。
 * @param start 直线上的一点。
 * @param end 直线上的另一点。
 * @returns 交点，按两端点到直线的有向距离线性插值得到。
 */
function crossing(
  from: Point<2>,
  to: Point<2>,
  start: Point<2>,
  end: Point<2>,
): Point<2> {
  const before = side(start, end, from);
  const ratio = before / (before - side(start, end, to));
  return {
    x: from.x + (to.x - from.x) * ratio,
    y: from.y + (to.y - from.y) * ratio,
  };
}

/**
 * 多边形的轴对齐包围盒。
 *
 * @param polygon 非空多边形；为空时四边为 ±Infinity。
 * @returns 包住所有顶点的最小包围盒。
 * @example
 * extent(corners(state)); // 旋转后节点在容器空间里占据的矩形范围
 */
export function extent(polygon: Polygon): Bounds {
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

/**
 * 点集的平均点；对状态的四个角即边框盒中心。
 *
 * 用于求多指输入的质心、多边形的几何中心等。
 *
 * @param points 非空点集；为空时结果为 `NaN`。
 * @returns 各点坐标的平均值。
 * @example
 * centroid([{ x: 0, y: 0 }, { x: 10, y: 20 }]); // { x: 5, y: 10 }
 */
export function centroid(points: Polygon): Point<2> {
  const sum = points.reduce(
    (total, point) => ({ x: total.x + point.x, y: total.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/**
 * 多边形面积。
 *
 * @param polygon 简单多边形（边不自交），顶点顺序不限。
 * @returns 面积，恒为非负；少于 3 个顶点时为 0。
 * @example
 * area([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }]); // 12
 */
export const area = (polygon: Polygon): number => Math.abs(signed(polygon));

/**
 * 仿射矩阵的线性缩放因子 `√|det|`：把屏幕像素换算成矩阵另一侧的长度时使用。
 *
 * 例如容器被缩放 2 倍时，屏幕上的 10px 吸附距离在容器空间里只有 5px。
 *
 * @param matrix 仿射矩阵。
 * @returns 面积缩放比的平方根；非等比缩放时为两个方向缩放的几何平均。
 */
export const scale = ([a, b, c, d]: Matrix<2, "affine">): number =>
  Math.sqrt(Math.abs(a * d - b * c));

/**
 * 判断点是否在凸多边形内（含边界）。
 *
 * 点相对每条边的叉积同号即在内部，与顶点方向无关；只适用于凸多边形，
 * 矩形经仿射变换后仍是凸的，所以可以直接用于旋转、斜切后的节点。
 *
 * @param polygon 凸多边形。
 * @param point 待测点，与多边形在同一坐标空间。
 * @returns 在内部或边上时为 `true`。
 * @example
 * contains(corners(state), pointer); // 指针是否落在旋转后的节点上
 */
export function contains(polygon: Polygon, point: Point<2>): boolean {
  let winding = 0;
  for (const [start, end] of edges(polygon)) {
    const sign = Math.sign(side(start, end, point));
    if (sign === 0) continue;
    if (winding === 0) winding = sign;
    else if (sign !== winding) return false;
  }
  return true;
}

/**
 * 用凸多边形裁剪另一个多边形（Sutherland–Hodgman）。
 *
 * 依次用 `clip` 的每条边所在直线切掉 `subject` 落在外侧的部分，复杂度 O(n·m)。
 * 常与 {@link area} 搭配求重叠面积，例如放置区的 `overlap` 判定。
 *
 * @param subject 被裁剪的多边形，凹凸均可。
 * @param clip 用来裁剪的凸多边形，顶点方向不限。
 * @returns 两者的交集；不相交时为空数组。
 * @example
 * area(intersect(corners(dragged), corners(zone))); // 两个旋转矩形的重叠面积
 */
export function intersect(subject: Polygon, clip: Polygon): Polygon {
  const winding = Math.sign(signed(clip));
  let result = subject;
  for (const [start, end] of edges(clip)) {
    /** 点是否在当前裁剪边的内侧（含边上），按 `clip` 的顶点方向统一正负。 */
    const inside = (point: Point<2>) => side(start, end, point) * winding >= 0;
    const kept: Point<2>[] = [];
    for (const [from, to] of edges(result)) {
      if (inside(to)) {
        if (!inside(from)) kept.push(crossing(from, to, start, end));
        kept.push(to);
      } else if (inside(from)) {
        kept.push(crossing(from, to, start, end));
      }
    }
    result = kept;
    if (result.length === 0) break;
  }
  return result;
}

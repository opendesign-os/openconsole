/**
 * @file 平面几何基础：区间、范围、包围盒、多边形与参考线，以及包围盒、面积、包含、裁剪等纯函数。
 *
 * 不引用 DOM；多边形顶点按顺序首尾相连，顺时针或逆时针都可以。
 */

import type { Matrix, Point } from "@openconsole/matrix";

/** 闭区间 `[min, max]`。 */
export interface Span {
  /** 下界。 */
  readonly min: number;
  /** 上界。 */
  readonly max: number;
}

/** 可只给一端的范围；缺省的一端视为不限。 */
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

/** 浮点比较的容差。 */
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

/** 叉积：`point` 在有向线段 `start → end` 左侧为正、右侧为负、共线为 0。 */
const side = (start: Point<2>, end: Point<2>, point: Point<2>): number =>
  (end.x - start.x) * (point.y - start.y) -
  (end.y - start.y) * (point.x - start.x);

/** 多边形的各条边，最后一条连回起点。 */
const edges = (polygon: Polygon): [Point<2>, Point<2>][] =>
  polygon.map((start, index) => [
    start,
    polygon[(index + 1) % polygon.length] ?? start,
  ]);

/** 有向面积（鞋带公式），正负反映顶点方向。 */
function signed(polygon: Polygon): number {
  let sum = 0;
  for (const [start, end] of edges(polygon)) {
    sum += start.x * end.y - end.x * start.y;
  }
  return sum / 2;
}

/** 线段 `from → to` 与直线 `start → end` 的交点。 */
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
 * @param polygon 多边形。
 * @returns 包住所有顶点的最小包围盒。
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
 * @param points 非空点集。
 * @returns 各点坐标的平均值。
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
 * @param polygon 简单多边形。
 * @returns 面积，恒为非负。
 */
export const area = (polygon: Polygon): number => Math.abs(signed(polygon));

/**
 * 仿射矩阵的线性缩放因子 `√|det|`：把屏幕像素换算成矩阵另一侧的长度时使用。
 *
 * @param matrix 仿射矩阵。
 * @returns 面积缩放比的平方根；非等比缩放时为两个方向缩放的几何平均。
 */
export const scale = ([a, b, c, d]: Matrix<2, "affine">): number =>
  Math.sqrt(Math.abs(a * d - b * c));

/**
 * 判断点是否在凸多边形内（含边界）。
 *
 * 点相对每条边的叉积同号即在内部，与顶点方向无关；只适用于凸多边形。
 *
 * @param polygon 凸多边形。
 * @param point 待测点。
 * @returns 在内部或边上时为 `true`。
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
 * @param subject 被裁剪的多边形。
 * @param clip 用来裁剪的凸多边形。
 * @returns 两者的交集；不相交时为空数组。
 */
export function intersect(subject: Polygon, clip: Polygon): Polygon {
  const winding = Math.sign(signed(clip));
  let result = subject;
  for (const [start, end] of edges(clip)) {
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

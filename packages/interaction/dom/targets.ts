/**
 * @file 选取与量取目标元素：条目查询、磁吸与碰撞的目标、拖入容器的命中判断。
 *
 * 带 `data-layer` 的元素是本库生成的覆盖层（网格线、参考线、占位框、手柄），一律不当作条目或目标。
 */

import { plane, type Point } from "@openconsole/matrix";

import { choose, type Context } from "../core";
import { contains, type Polygon } from "../model";
import { outline } from "./measure";

/**
 * 是否是本库生成的覆盖层元素（带 `data-layer`，如网格线、参考线、占位框、手柄）。
 *
 * @param element 要检查的元素。
 * @returns 是覆盖层时为 true。
 */
export const layered = (element: Element): boolean =>
  element instanceof HTMLElement && element.dataset["layer"] !== undefined;

/**
 * 在 `root` 里按选择器取元素，排除覆盖层与非 HTML 元素。
 *
 * @param root 查找范围。
 * @param selector CSS 选择器，相对 `root` 求值；缺省为直接子元素 `":scope > *"`。
 * @returns 匹配的元素，按文档顺序。
 */
export const query = (
  root: ParentNode,
  selector = ":scope > *",
): HTMLElement[] =>
  [...root.querySelectorAll(selector)].flatMap((element) =>
    element instanceof HTMLElement && !layered(element) ? [element] : [],
  );

/**
 * 解析目标说明：字符串时在 `root` 里按选择器任意层级查找；`true` 时取父元素与兄弟元素（不含覆盖层）。
 */
function select(
  node: HTMLElement,
  value: true | string,
  root: ParentNode,
): Element[] {
  if (typeof value === "string") return [...root.querySelectorAll(value)];
  const parent = node.parentElement;
  if (!parent) return [];
  return [parent, ...[...parent.children].filter((child) => !layered(child))];
}

/**
 * 生成 `magnet`、`collide` 插件需要的目标函数：会话开始时把目标元素量成多边形，换到被拖节点的容器空间。
 *
 * 目标为 `true` 时取父元素与兄弟元素，父元素的边与中线也能吸附；为字符串时在 `root` 里按选择器任意层级查找。
 * 被拖节点自身与后代自动排除。先取屏幕多边形，再经 `context.frame` 换到容器空间，
 * 所以跨层级、带旋转或缩放的容器之间同样精确。
 *
 * @param node 被拖节点。
 * @param value `true` 或 CSS 选择器。
 * @param root 选择器的查找范围，通常为 `container`，没有时为 `document`。
 * @returns `(context) => Polygon[]`，由插件在会话开始时调用一次。
 * @example
 * magnet(outlines(card, ".card, .group", board));
 * collide(outlines(card, true, document));
 */
export const outlines =
  (node: HTMLElement, value: true | string, root: ParentNode) =>
  (context: Pick<Context, "frame">): Polygon[] =>
    select(node, value, root).flatMap((element) => {
      if (node.contains(element) || !(element instanceof HTMLElement)) {
        return [];
      }
      const polygon = outline(element);
      if (!polygon) return [];
      return [polygon.map((point) => plane.apply(context.frame, point))];
    });

/**
 * 量取一组候选容器的屏幕多边形，返回命中函数：给定屏幕点，找出包含它的最内层容器。
 *
 * 多边形只在调用 `probe` 时量一次（通常在会话开始时），被拖节点自身与后代不参与；
 * 多个容器都包含该点时取嵌套最深的一个（见 {@link choose}）。
 *
 * @param elements 候选容器。
 * @param node 被拖节点，自身与后代不作为候选。
 * @returns `(point) => HTMLElement | undefined`：`point` 为屏幕坐标；没有容器包含该点时为 undefined。
 */
export function probe(
  elements: Iterable<Element>,
  node: HTMLElement,
): (point: Point<2>) => HTMLElement | undefined {
  const areas = [...elements].flatMap((target) => {
    if (!(target instanceof HTMLElement) || node.contains(target)) return [];
    const polygon = outline(target);
    return polygon ? [{ target, polygon }] : [];
  });
  return (point) =>
    choose(
      areas.flatMap(({ target, polygon }) =>
        contains(polygon, point) ? [{ target, score: 0 }] : [],
      ),
      (outer, inner) => outer.contains(inner),
    );
}

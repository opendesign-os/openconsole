/**
 * @file 自动生成的调整尺寸手柄与旋转把手。
 *
 * 手柄都是节点的子元素（`<i>`），带 `data-layer="grip"`，随节点一起变换；颜色取 CSS 变量 `--grip`
 * （缺省 `#4f46e5`）。手柄绝对定位，节点须是它们的包含块：`Resizable`、`Rotatable` 自动生成手柄时
 * 先用 {@link relative} 把静态定位的节点改为相对定位。元素由调用方负责移除，`Resizable`、`Rotatable`
 * 在重建或销毁时移除自己生成的手柄并还原定位。
 */

import type { Handle } from "../core";

/** {@link relative} 对一个节点的改动记录。 */
interface Hold {
  /** 仍在持有的能力数，降到 0 时还原。 */
  count: number;
  /** 改动前的内联 `position`，最后一个持有者释放时写回。 */
  readonly saved: string;
}

/** 被 {@link relative} 改为相对定位的节点及其改动记录。 */
const holds = new WeakMap<HTMLElement, Hold>();

/**
 * 让节点成为绝对定位子元素（手柄）的包含块：计算样式为 `static` 时把内联 `position` 改为 `relative`。
 *
 * View 在矩阵为单位矩阵时写 `transform: none`，静态定位的节点此时不是包含块，手柄会相对更外层的祖先定位。
 * `relative` 不移动节点本身，但样式表里原本不生效的 `top`、`left`、`z-index` 会随之生效。
 * 同一节点可被多个能力持有，最后一个持有者释放时才写回原来的内联值。
 *
 * @param node 手柄所在的节点。
 * @returns 释放函数，可重复调用；节点本就不是静态定位时什么也不做。
 * @example
 * const release = relative(card);
 * const handles = grips(card);
 * // …销毁时
 * for (const grip of handles.keys()) grip.remove();
 * release();
 */
export function relative(node: HTMLElement): () => void {
  const hold = holds.get(node);
  if (hold) {
    hold.count += 1;
  } else if (getComputedStyle(node).position === "static") {
    holds.set(node, { count: 1, saved: node.style.position });
    node.style.position = "relative";
  } else {
    return () => undefined;
  }
  let released = false;
  return () => {
    const current = holds.get(node);
    if (released || !current) return;
    released = true;
    current.count -= 1;
    if (current.count > 0) return;
    holds.delete(node);
    node.style.position = current.saved;
  };
}

/** 边框盒四角与四边中点共 8 个手柄方向，按从上到下、从左到右排列；`x`、`y` 取 -1、0、1。 */
const around: readonly Handle[] = [
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: 1 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
];

/**
 * 按手柄方向选光标：上下边 `ns-resize`，左右边 `ew-resize`，对角按方向取 `nwse` 或 `nesw`。
 *
 * 光标按未旋转的方向选取，节点旋转后不随之转动。
 *
 * @param handle 手柄方向。
 * @returns CSS `cursor` 值。
 */
const cursor = ({ x, y }: Handle): string => {
  if (x === 0) return "ns-resize";
  if (y === 0) return "ew-resize";
  return x === y ? "nwse-resize" : "nesw-resize";
};

/**
 * 生成一个 10px 方形手柄并追加为节点的最后一个子元素。
 *
 * `left`、`top` 取 `(方向 + 1) / 2` 的百分比，再用负外边距把手柄中心对齐到节点内边距盒的角或边中点
 * （节点没有边框时即边框盒）；白底、1px `--grip` 色描边、2px 圆角。
 *
 * @param node 手柄所属的节点。
 * @param handle 手柄方向。
 * @returns 新建的手柄元素。
 */
function grip(node: HTMLElement, handle: Handle): HTMLElement {
  const element = node.ownerDocument.createElement("i");
  element.dataset.layer = "grip";
  Object.assign(element.style, {
    position: "absolute",
    left: `${((handle.x + 1) / 2) * 100}%`,
    top: `${((handle.y + 1) / 2) * 100}%`,
    width: "10px",
    height: "10px",
    margin: "-5px 0 0 -5px",
    boxSizing: "border-box",
    border: "1px solid var(--grip, #4f46e5)",
    borderRadius: "2px",
    background: "#fff",
    cursor: cursor(handle),
  });
  node.append(element);
  return element;
}

/**
 * 在节点里生成调整尺寸手柄，供 `resize` 动作使用。
 *
 * 每个方向一个元素，按 `handles` 的顺序追加到节点末尾。
 *
 * @param node 要调整尺寸的节点，手柄作为其子元素插入。
 * @param handles 要生成的方向，缺省为四角与四边中点共 8 个。
 * @returns 手柄元素到方向的映射，可直接作为 `Resizable` 的 `handles`；不再需要时由调用方移除元素。
 * @example
 * const handles = grips(card, [{ x: 1, y: 1 }]); // 只在右下角生成一个
 * new Resizable(card, { handles });
 */
export function grips(
  node: HTMLElement,
  handles: readonly Handle[] = around,
): Map<Element, Handle> {
  return new Map(handles.map((handle) => [grip(node, handle), handle]));
}

/**
 * 在节点上方居中生成一个圆形旋转把手。
 *
 * 把手直径 12px、填充 `--grip` 色、光标为 `grab`，水平居中，顶边位于节点内边距盒上边之上 24px；
 * 作为最后一个子元素追加，随节点一起旋转。
 *
 * @param node 要旋转的节点，把手作为其子元素插入。
 * @returns 把手元素，可作为 `Rotatable` 的 `handle`；不再需要时由调用方移除。
 * @example
 * const handle = knob(card);
 * new Rotatable(card, { handle });
 */
export function knob(node: HTMLElement): HTMLElement {
  const element = node.ownerDocument.createElement("i");
  element.dataset.layer = "grip";
  Object.assign(element.style, {
    position: "absolute",
    left: "50%",
    top: "-24px",
    width: "12px",
    height: "12px",
    marginLeft: "-6px",
    borderRadius: "50%",
    background: "var(--grip, #4f46e5)",
    cursor: "grab",
  });
  node.append(element);
  return element;
}

/**
 * @file 自动生成的调整尺寸手柄与旋转把手。
 *
 * 手柄都是节点的子元素，带 `data-layer="grip"`，随节点一起变换；颜色取 CSS 变量 `--grip`。
 */

import type { Handle } from "../core";

/** 边框盒四角与四边中点共 8 个手柄方向，`x`、`y` 取 -1、0、1。 */
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

/** 按手柄方向选光标：上下边 `ns-resize`，左右边 `ew-resize`，对角按方向取 `nwse` 或 `nesw`。 */
const cursor = ({ x, y }: Handle): string => {
  if (x === 0) return "ns-resize";
  if (y === 0) return "ew-resize";
  return x === y ? "nwse-resize" : "nesw-resize";
};

/** 生成一个 10px 方形手柄，按方向把中心对齐到边框盒的角或边中点。 */
function grip(node: HTMLElement, handle: Handle): HTMLElement {
  const element = node.ownerDocument.createElement("i");
  element.dataset["layer"] = "grip";
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
 * @param node 要调整尺寸的节点，手柄作为其子元素插入。
 * @param handles 要生成的方向，缺省为四角与四边中点共 8 个。
 * @returns 手柄元素到方向的映射，可直接作为 `Resizable` 的 `handles`；不再需要时由调用方移除元素。
 * @example
 * const handles = grips(card, [{ x: 1, y: 1 }]); // 只在右下角生成一个
 */
export function grips(
  node: HTMLElement,
  handles: readonly Handle[] = around,
): Map<Element, Handle> {
  return new Map(handles.map((handle) => [grip(node, handle), handle]));
}

/**
 * 在节点上方居中生成一个圆形旋转把手，距上边 24px。
 *
 * @param node 要旋转的节点，把手作为其子元素插入。
 * @returns 把手元素，可作为 `Rotatable` 的 `handle`；不再需要时由调用方移除。
 * @example
 * const handle = knob(card);
 */
export function knob(node: HTMLElement): HTMLElement {
  const element = node.ownerDocument.createElement("i");
  element.dataset["layer"] = "grip";
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

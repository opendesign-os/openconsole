import type { Handle } from "../core";

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

const cursor = ({ x, y }: Handle): string => {
  if (x === 0) return "ns-resize";
  if (y === 0) return "ew-resize";
  return x === y ? "nwse-resize" : "nesw-resize";
};

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

export function grips(
  node: HTMLElement,
  handles: readonly Handle[] = around,
): Map<Element, Handle> {
  return new Map(handles.map((handle) => [grip(node, handle), handle]));
}

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

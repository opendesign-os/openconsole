import { plane, space, type Matrix } from "@openconsole/matrix";

const units = new Map([
  ["deg", Math.PI / 180],
  ["grad", Math.PI / 200],
  ["rad", 1],
  ["turn", 2 * Math.PI],
]);

const axes = new Map([
  ["x", { x: 1, y: 0, z: 0 }],
  ["y", { x: 0, y: 1, z: 0 }],
  ["z", { x: 0, y: 0, z: 1 }],
]);

function radians(text: string): number {
  const unit = /[a-z]+$/i.exec(text)?.[0].toLowerCase() ?? "deg";
  return Number.parseFloat(text) * (units.get(unit) ?? 0);
}

function rotation(text: string): Matrix<3, "projective"> {
  if (text === "none") return space.identity;
  const parts = text.trim().split(/\s+/);
  const angle = radians(parts.at(-1) ?? "");
  const axis =
    parts.length === 4
      ? { x: Number(parts[0]), y: Number(parts[1]), z: Number(parts[2]) }
      : (axes.get(parts[0] ?? "") ?? { x: 0, y: 0, z: 1 });
  return space.rotate(angle, axis);
}

const factor = (text: string): number =>
  text.endsWith("%") ? Number.parseFloat(text) / 100 : Number.parseFloat(text);

function scaling(text: string): Matrix<3, "projective"> {
  if (text === "none") return space.identity;
  const [x = 1, y = x, z = 1] = text.trim().split(/\s+/).map(factor);
  return space.scale(x, y, z);
}

export function frame(node: Element): Matrix<2, "affine"> {
  const own = getComputedStyle(node);
  let chain = space.multiply(rotation(own.rotate), scaling(own.scale));
  for (
    let element = node.parentElement;
    element;
    element = element.parentElement
  ) {
    const style = getComputedStyle(element);
    chain = space.multiply(
      rotation(style.rotate),
      scaling(style.scale),
      space.parse(style.transform),
      chain,
    );
  }
  return plane.invert(plane.linear(space.flatten(chain))) ?? plane.identity;
}

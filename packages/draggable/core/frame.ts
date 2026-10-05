import { plane, space, type Matrix } from "@openconsole/matrix";

const axes = new Map([
  ["x", { x: 1, y: 0, z: 0 }],
  ["y", { x: 0, y: 1, z: 0 }],
]);

function rotation(text: string): Matrix<3, "projective"> {
  if (text === "none") return space.identity;
  const parts = text.split(" ");
  const angle = (Number.parseFloat(parts.at(-1) ?? "") * Math.PI) / 180;
  const axis =
    parts.length === 4
      ? { x: Number(parts[0]), y: Number(parts[1]), z: Number(parts[2]) }
      : (axes.get(parts[0] ?? "") ?? { x: 0, y: 0, z: 1 });
  return space.rotate(angle, axis);
}

function scaling(text: string): Matrix<3, "projective"> {
  if (text === "none") return space.identity;
  const [x = 1, y = x, z = 1] = text.split(" ").map(Number);
  return space.scale(x, y, z);
}

function local(
  style: CSSStyleDeclaration,
  transform: string,
): Matrix<2, "affine"> {
  return space.flatten(
    space.multiply(
      rotation(style.rotate),
      scaling(style.scale),
      space.parse(transform),
    ),
  );
}

export function frame(node: Element): Matrix<2, "affine"> {
  let chain = local(getComputedStyle(node), "none");
  for (
    let element = node.parentElement;
    element;
    element = element.parentElement
  ) {
    const style = getComputedStyle(element);
    chain = plane.multiply(local(style, style.transform), chain);
  }
  return plane.invert(plane.linear(chain)) ?? plane.identity;
}

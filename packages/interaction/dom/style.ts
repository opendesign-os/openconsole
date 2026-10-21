import { plane, space, type Matrix, type Point } from "@openconsole/matrix";

import type { Size } from "../core";

export interface Computed {
  readonly origin: string;
  readonly translate: string;
  readonly rotate: string;
  readonly scale: string;
  readonly transform: string;
}

const axes = new Map([
  ["x", { x: 1, y: 0, z: 0 }],
  ["y", { x: 0, y: 1, z: 0 }],
  ["z", { x: 0, y: 0, z: 1 }],
]);

export function rotation(text: string): Matrix<3, "projective"> {
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

function length(token: string | undefined, base: number): number | undefined {
  if (token === undefined) return 0;
  if (token.endsWith("px")) return Number.parseFloat(token);
  if (token.endsWith("%")) return (Number.parseFloat(token) / 100) * base;
  return undefined;
}

function translation(
  text: string,
  size: Size,
): Matrix<3, "projective"> | undefined {
  if (text === "none") return space.identity;
  if (text.includes("(")) return undefined;
  const [x, y, z] = text.split(" ");
  const dx = length(x, size.width);
  const dy = length(y, size.height);
  const dz = length(z, 0);
  if (dx === undefined || dy === undefined || dz === undefined)
    return undefined;
  return space.translate(dx, dy, dz);
}

function point(text: string): Point<3> | undefined {
  const [x, y, z = 0] = text
    .split(" ")
    .map((token) =>
      token.endsWith("px") ? Number.parseFloat(token) : Number.NaN,
    );
  if (x === undefined || y === undefined) return undefined;
  if ([x, y, z].some(Number.isNaN)) return undefined;
  return { x, y, z };
}

export const local = (
  computed: Pick<Computed, "rotate" | "scale" | "transform">,
): Matrix<2, "affine"> =>
  plane.linear(
    space.flatten(
      space.multiply(
        rotation(computed.rotate),
        scaling(computed.scale),
        space.parse(computed.transform),
      ),
    ),
  );

export function fold(
  computed: Computed,
  size: Size,
): Matrix<2, "affine"> | undefined {
  const origin = point(computed.origin);
  const shift = translation(computed.translate, size);
  if (!origin || !shift) return undefined;
  return space.flatten(
    space.multiply(
      space.translate(origin.x, origin.y, origin.z),
      shift,
      rotation(computed.rotate),
      scaling(computed.scale),
      space.parse(computed.transform),
      space.translate(-origin.x, -origin.y, -origin.z),
    ),
  );
}

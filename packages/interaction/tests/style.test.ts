import { describe, expect, it } from "vitest";

import { plane, space } from "@openconsole/matrix";

import { fold, local, rotation } from "../dom";

const size = { width: 100, height: 50 };

describe("fold", () => {
  it("composes origin, translate, rotate, scale and transform in the spec order", () => {
    const folded = fold(
      {
        origin: "50px 25px",
        translate: "10px 20px",
        rotate: "30deg",
        scale: "2 1.5",
        transform: "matrix(1, 0.2, 0, 1, 5, 6)",
      },
      size,
    );
    const expected = space.flatten(
      space.multiply(
        space.translate(50, 25, 0),
        space.translate(10, 20, 0),
        space.rotate(Math.PI / 6, { x: 0, y: 0, z: 1 }),
        space.scale(2, 1.5, 1),
        space.lift([1, 0.2, 0, 1, 5, 6]),
        space.translate(-50, -25, 0),
      ),
    );
    expect(folded && plane.round(folded)).toEqual(plane.round(expected));
  });

  it("resolves a percentage translate against the size", () => {
    const folded = fold(
      {
        origin: "0px 0px",
        translate: "50% 10px",
        rotate: "none",
        scale: "none",
        transform: "none",
      },
      size,
    );
    expect(folded).toEqual(plane.translate(50, 10));
  });

  it("gives up on an unresolved origin or a calc() translate", () => {
    const rest = { rotate: "none", scale: "none", transform: "none" };
    expect(
      fold({ ...rest, origin: "50% 50%", translate: "none" }, size),
    ).toBeUndefined();
    expect(
      fold(
        { ...rest, origin: "0px 0px", translate: "calc(50% + 10px) 0px" },
        size,
      ),
    ).toBeUndefined();
  });
});

describe("rotation", () => {
  it("reads the computed rotate forms", () => {
    expect(rotation("none")).toEqual(space.identity);
    expect(space.round(rotation("90deg"))).toEqual(
      space.round(space.rotate(Math.PI / 2, { x: 0, y: 0, z: 1 })),
    );
    expect(space.round(rotation("x 90deg"))).toEqual(
      space.round(space.rotate(Math.PI / 2, { x: 1, y: 0, z: 0 })),
    );
    expect(space.round(rotation("1 1 0 90deg"))).toEqual(
      space.round(space.rotate(Math.PI / 2, { x: 1, y: 1, z: 0 })),
    );
  });
});

describe("local", () => {
  it("keeps only the linear part of rotate, scale and transform", () => {
    expect(
      plane.round(
        local({
          rotate: "none",
          scale: "2",
          transform: "matrix(1, 0, 0, 1, 40, 50)",
        }),
      ),
    ).toEqual(plane.scale(2));
  });
});

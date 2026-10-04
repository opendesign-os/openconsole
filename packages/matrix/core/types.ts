interface Matrices {
  2: {
    affine: readonly [
      a: number,
      b: number,
      c: number,
      d: number,
      e: number,
      f: number,
    ];
  };
  3: {
    projective: readonly [
      m11: number,
      m12: number,
      m13: number,
      m14: number,
      m21: number,
      m22: number,
      m23: number,
      m24: number,
      m31: number,
      m32: number,
      m33: number,
      m34: number,
      m41: number,
      m42: number,
      m43: number,
      m44: number,
    ];
  };
}

interface Points {
  2: { readonly x: number; readonly y: number };
  3: { readonly x: number; readonly y: number; readonly z: number };
}

export type Dimension = keyof Matrices;

export type Category<D extends Dimension> = D extends Dimension
  ? keyof Matrices[D]
  : never;

export type Matrix<
  D extends Dimension,
  C extends Category<D>,
> = D extends Dimension ? Matrices[D][C & keyof Matrices[D]] : never;

export type Point<D extends Dimension> = Points[D];

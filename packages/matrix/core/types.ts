/**
 * @file 类型表：按维数与类别查出矩阵与点的具体元组类型。
 *
 * 新增组合（如三维仿射、二维射影）时先在 {@link Matrices} 里登记元组，
 * 再新建一个命名空间实现它的运算。
 */

/**
 * 维数 → 类别 → 矩阵元组的查找表。
 *
 * 元素名与 CSS、`DOMMatrix` 一致，可直接解构：二维为 `a`–`f`，三维为 `m11`–`m44`。
 * 列主序，参数顺序同 CSS `matrix()` 与 `matrix3d()`。
 */
interface Matrices {
  2: {
    /** 二维仿射：2×3，末行恒为 `0 0 1`，只存上方两行，`apply` 无需除法。 */
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
    /** 三维射影：完整 4×4，不对末行作假设，`apply` 按齐次分量 `w` 做透视除法。 */
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

/** 维数 → 点的查找表。坐标系沿用 CSS：y 轴向下。 */
interface Points {
  2: { readonly x: number; readonly y: number };
  3: { readonly x: number; readonly y: number; readonly z: number };
}

/** 已登记的维数。 */
export type Dimension = keyof Matrices;

/**
 * 某个维数下已登记的类别。
 *
 * @template D 维数。
 */
export type Category<D extends Dimension> = D extends Dimension
  ? keyof Matrices[D]
  : never;

/**
 * 维数与类别对应的矩阵元组，例如 `Matrix<2, "affine">` 为 6 个数的只读元组。
 *
 * @template D 维数。
 * @template C 类别。
 */
export type Matrix<
  D extends Dimension,
  C extends Category<D>,
> = D extends Dimension ? Matrices[D][C & keyof Matrices[D]] : never;

/**
 * 某个维数的点。
 *
 * @template D 维数。
 */
export type Point<D extends Dimension> = Points[D];

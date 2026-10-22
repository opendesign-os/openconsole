/**
 * @file 类型表：按维数与类别查出矩阵与点的具体元组类型。
 *
 * 新增组合（如三维仿射、二维射影）时先在 {@link Matrices} 里登记元组，
 * 再新建一个命名空间实现它的运算；{@link Matrix}、{@link Category} 会自动收录新组合。
 */

/**
 * 维数 → 类别 → 矩阵元组的查找表。
 *
 * 元素名与 CSS、`DOMMatrix` 一致，可直接解构：二维为 `a`–`f`，三维为 `m11`–`m44`。
 * 列主序，参数顺序同 CSS `matrix()` 与 `matrix3d()`，可原样传给 `new DOMMatrix([...])`。
 */
interface Matrices {
  /** 二维：目前只登记了仿射一种类别。 */
  2: {
    /**
     * 二维仿射：3×3 齐次矩阵，末行恒为 `0 0 1`，只存上方两行共 6 个数。
     *
     * 点 `(x, y)` 映射为 `(a·x + c·y + e, b·x + d·y + f)`，`apply` 无需除法。
     */
    affine: readonly [
      a: number,
      b: number,
      c: number,
      d: number,
      e: number,
      f: number,
    ];
  };
  /** 三维：目前只登记了射影一种类别。 */
  3: {
    /**
     * 三维射影：完整 4×4 齐次矩阵，共 16 个数，`mij` 为第 i 列第 j 行。
     *
     * 不对末行作假设，所以能表达透视；`apply` 按齐次分量 `w` 做透视除法。
     */
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

/** 维数 → 点的查找表。坐标系沿用 CSS：x 轴向右，y 轴向下，z 轴朝向观察者。 */
interface Points {
  /** 二维点。 */
  2: {
    /** 横坐标，向右为正。 */
    readonly x: number;
    /** 纵坐标，向下为正。 */
    readonly y: number;
  };
  /** 三维点。 */
  3: {
    /** 横坐标，向右为正。 */
    readonly x: number;
    /** 纵坐标，向下为正。 */
    readonly y: number;
    /** 深度坐标，朝向观察者为正。 */
    readonly z: number;
  };
}

/** 已登记的维数，目前为 `2 | 3`。 */
export type Dimension = keyof Matrices;

/**
 * 某个维数下已登记的类别，例如 `Category<2>` 为 `"affine"`。
 *
 * `D` 为联合类型时按成员分别求值再合并，`Category<2 | 3>` 为 `"affine" | "projective"`。
 *
 * @template D 维数。
 */
export type Category<D extends Dimension> = D extends Dimension
  ? keyof Matrices[D]
  : never;

/**
 * 维数与类别对应的矩阵元组，例如 `Matrix<2, "affine">` 为 6 个数的只读元组。
 *
 * 元组带有与 CSS 一致的元素名，悬停即可看到每一位的含义。
 *
 * @template D 维数。
 * @template C 类别，必须是 `D` 下已登记的类别。
 * @example
 * const view: Matrix<2, "affine"> = [1, 0, 0, 1, 10, 20];
 * const [a, b, c, d, e, f] = view; // 按 CSS matrix() 的顺序解构
 */
export type Matrix<
  D extends Dimension,
  C extends Category<D>,
> = D extends Dimension ? Matrices[D][C & keyof Matrices[D]] : never;

/**
 * 某个维数的点，坐标系沿用 CSS。
 *
 * @template D 维数。
 * @example
 * const point: Point<2> = { x: 10, y: 20 };
 */
export type Point<D extends Dimension> = Points[D];

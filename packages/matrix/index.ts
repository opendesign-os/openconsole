/**
 * @file `@openconsole/matrix` 的公开入口。
 *
 * 每个「维数 × 类别」组合一个命名空间：`plane` 为二维仿射（6 个数，对应 CSS `matrix()`），
 * `space` 为三维射影（16 个数，对应 CSS `matrix3d()`）。调用处直接选命名空间，不做运行时分派；
 * 两个命名空间的函数同名同义（`translate`、`multiply`、`invert`、`apply`、`parse`、`format` 等），
 * 换维数只需换命名空间。矩阵都是定长只读元组，所有函数都是纯函数，可放心共享与缓存。
 *
 * 类型 `Matrix<D, C>`、`Point<D>` 按维数与类别查出对应元组与点，`Dimension`、`Category`
 * 列出已登记的组合。
 */

export * as plane from "./core/plane";
export * as space from "./core/space";
export type { Category, Dimension, Matrix, Point } from "./core/types";

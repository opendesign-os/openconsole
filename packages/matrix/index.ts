/**
 * @file `@openconsole/matrix` 的公开入口。
 *
 * 每个「维数 × 类别」组合一个命名空间：`plane` 为二维仿射，`space` 为三维射影。
 * 调用处直接选命名空间，不做运行时分派。
 */

export * as plane from "./core/plane";
export * as space from "./core/space";
export type { Category, Dimension, Matrix, Point } from "./core/types";

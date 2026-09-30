import type { Algebra } from "./core/algebra";
import * as plane from "./core/plane";
import * as space from "./core/space";

plane satisfies Algebra<plane.Matrix, plane.Point>;
space satisfies Algebra<space.Matrix, space.Point>;

export { plane, space, type Algebra };

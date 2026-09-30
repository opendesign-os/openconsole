export interface Algebra<Matrix, Point> {
  readonly identity: Matrix;
  from(values: ArrayLike<number>): Matrix;
  multiply(...matrices: readonly Matrix[]): Matrix;
  invert(matrix: Matrix): Matrix | undefined;
  linear(matrix: Matrix): Matrix;
  around(pivot: Point, matrix: Matrix): Matrix;
  apply(matrix: Matrix, point: Point): Point;
  apply(
    matrix: Matrix,
    points: Float64Array,
    target?: Float64Array,
  ): Float64Array;
  equals(left: Matrix, right: Matrix, epsilon?: number): boolean;
  round(matrix: Matrix, digits?: number): Matrix;
  format(matrix: Matrix): string;
  parse(text: string): Matrix;
}

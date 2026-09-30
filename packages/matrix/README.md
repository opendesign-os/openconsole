# @openconsole/matrix

二维仿射与三维射影变换矩阵:定长只读元组、纯函数,与 CSS `transform` 直接互通。

## 特性

- **维数 × 类别**:每个组合一个命名空间——`plane`(二维仿射,6 个数)、`space`(三维射影,16 个数),调用处不做运行时分派
- **共享契约** `Algebra<Matrix, Point>`:各组合的共有成员同名同义,由编译器校验;与维数无关的代码写一次,传入 `plane` 或 `space` 即可
- **定长只读元组**:`plane.Matrix` / `space.Matrix` 的元素名与 CSS / `DOMMatrix` 一致(`a`–`f`、`m11`–`m44`),可直接解构与序列化
- **纯函数**:所有运算返回新矩阵,从不修改入参;`identity` 是共享的只读常量
- **CSS 互通**:`format` 输出 `matrix()` / `matrix3d()`,`parse` 读回(含 `none`)
- **批量变换**:`apply` 直接处理交错存放的 `Float64Array` 坐标,循环内零分配
- **二维分解**:`decompose` / `compose` 在矩阵与位移、旋转、斜切、缩放之间往返
- 零运行时依赖

## 在本仓库中使用

```json
{
  "dependencies": {
    "@openconsole/matrix": "workspace:*"
  }
}
```

## 维数 × 类别

参照 Eigen 的 `Transform<Scalar, Dim, Mode>` 与 nalgebra 的 `Transform<T, C, D>`:变换由维数与类别共同确定,二者决定存储布局、`apply` 的语义与求逆算法。
每个组合是一个命名空间,使用定长元组与手写的运算内核,不做 `Matrix<N>` 式的通用循环实现;
组合之间的共有成员由 `Algebra` 契约约束。

|      | 仿射               | 射影                |
| ---- | ------------------ | ------------------- |
| 二维 | `plane`:2×3,6 个数 | —                   |
| 三维 | —                  | `space`:4×4,16 个数 |

- **仿射**:末行恒为 `0 … 0 1`,只存上方 D 行(Eigen 的 `AffineCompact`);`apply` 无需除法,不能表达透视
- **射影**:存完整的 (D+1)×(D+1) 矩阵,不做假设(Eigen 的 `Projective`);`apply` 按齐次分量 `w` 做透视除法
- **仿射 ⊂ 射影**(nalgebra 的 `TAffine ⊂ TProjective`):向更一般的组合转换总能成功,用显式函数完成,如 `space.lift`

新增组合(如三维仿射、二维射影)时,新建一个命名空间,并在 `index.ts` 以 `satisfies Algebra<Matrix, Point>` 登记。

## 约定

列主序,参数顺序与 CSS `matrix(a, b, c, d, e, f)` / `matrix3d(m11, m12, …, m44)` 相同:

```
二维              三维
| a  c  e |       | m11  m21  m31  m41 |
| b  d  f |       | m12  m22  m32  m42 |
| 0  0  1 |       | m13  m23  m33  m43 |
                  | m14  m24  m34  m44 |
```

- `multiply(A, B, C)` 即 A·B·C,作用于点时自右向左(先 C 后 A),与 CSS `transform: A B C` 的书写顺序一致
- 角度一律为弧度;坐标系沿用 CSS(y 轴向下,正角度在屏幕上顺时针)

## 使用指南

### 二维

```ts
import { plane } from "@openconsole/matrix";

const view = plane.multiply(plane.translate(100, 50), plane.scale(2));

plane.apply(view, { x: 1, y: 1 }); // { x: 102, y: 52 }
const inverse = plane.invert(view); // 奇异矩阵得到 undefined
if (inverse) plane.apply(inverse, { x: 102, y: 52 }); // { x: 1, y: 1 }
plane.around({ x: 50, y: 50 }, plane.rotate(Math.PI / 2)); // 绕点旋转

element.style.transform = plane.format(view); // "matrix(2, 0, 0, 2, 100, 50)"
plane.parse(getComputedStyle(element).transform); // "none" 得到 identity
```

批量变换交错坐标 `[x0, y0, x1, y1, …]`:

```ts
const points = Float64Array.of(0, 0, 10, 0, 10, 10);

plane.apply(view, points); // 写入新数组
plane.apply(view, points, points); // 原地写回
```

双指手势:把起始两指映射到当前两指的相似变换(平移、旋转、等比缩放):

```ts
const gesture = plane.pinch([start0, start1], [now0, now1]);
const next = plane.multiply(gesture, current);
```

分解与合成:

```ts
const parts = plane.decompose(matrix); // { translation, scale, rotation, skew }
plane.compose({ ...parts, rotation: 0 }); // 去掉旋转后重新合成
```

### 三维

```ts
import { plane, space } from "@openconsole/matrix";

const tilt = space.multiply(space.translate(0, 0, -100), space.rotate(Math.PI / 6, { x: 1, y: 0, z: 0 }));

space.apply(tilt, { x: 10, y: 10, z: 0 }); // 含透视除法
space.format(tilt); // "matrix3d(…)"

space.parse("matrix(1, 0, 0, 1, 10, 20)"); // 二维文本自动提升
space.lift(plane.translate(10, 20)); // 显式提升
```

### 与维数无关的代码

依赖 `Algebra` 契约而非具体组合,同一段代码对 `plane` 与 `space` 都成立:

```ts
import { plane, space, type Algebra } from "@openconsole/matrix";

function locate<Matrix, Point>(algebra: Algebra<Matrix, Point>, chain: readonly Matrix[], point: Point): Point | undefined {
  const inverse = algebra.invert(algebra.multiply(...chain));
  return inverse && algebra.apply(inverse, point);
}

locate(plane, [parent, child], { x: 120, y: 80 }); // 世界坐标 → child 的局部坐标
locate(space, [scene, model], { x: 120, y: 80, z: 0 });
```

## API

### `interface Algebra<Matrix, Point>`

各组合共享的契约(基本变换的签名随维数而异,不在此约束):

| 成员                             | 说明                                                                      |
| -------------------------------- | ------------------------------------------------------------------------- |
| `identity`                       | 单位矩阵(共享的只读常量)                                                  |
| `from(values)`                   | 由数组类构造(如 `Float64Array`、`DOMMatrix.toFloat64Array()`)             |
| `multiply(...matrices)`          | 连乘;无参返回 `identity`                                                  |
| `invert(matrix)`                 | 逆矩阵;奇异时返回 `undefined`                                             |
| `linear(matrix)`                 | 去掉平移,用于变换方向与位移量                                             |
| `around(pivot, matrix)`          | 以 `pivot` 为中心施加 `matrix`                                            |
| `apply(matrix, point)`           | 变换一个点                                                                |
| `apply(matrix, points, target?)` | 批量变换交错坐标;默认写入新数组,传 `target`(可以是 `points` 本身)则写入它 |
| `equals(left, right, epsilon)`   | 逐项容差比较,`epsilon` 默认 `1e-9`                                        |
| `round(matrix, digits)`          | 按小数位取整以清除浮点噪声,`digits` 默认 `10`                             |
| `format(matrix)`                 | 输出 CSS 函数文本                                                         |
| `parse(text)`                    | 解析 CSS 函数文本或 `none`                                                |

各组合的差异(`translate` / `scale` / `rotate` 同名,签名随维数而异):

|             | `plane`             | `space`                           |
| ----------- | ------------------- | --------------------------------- |
| `Matrix`    | 6 元组 `a`–`f`      | 16 元组 `m11`–`m44`               |
| `Point`     | `{ x, y }`          | `{ x, y, z }`                     |
| `translate` | `(x, y)`            | `(x, y, z)`                       |
| `scale`     | `(x, y = x)`        | `(x, y, z)`                       |
| `rotate`    | `(angle)`           | `(angle, axis)`,轴无需归一化      |
| `format`    | `matrix(…)`         | `matrix3d(…)`                     |
| `parse`     | `none`、`matrix(…)` | 另含 `matrix3d(…)`,二维文本会提升 |

### 仅 `plane`

| 成员                  | 说明                                                                |
| --------------------- | ------------------------------------------------------------------- |
| `skew(x, y = 0)`      | 斜切,同 CSS `skew()`                                                |
| `basis(origin, x, y)` | 把 `(0, 0)`、`(1, 0)`、`(0, 1)` 分别映射到 `origin`、`x`、`y`       |
| `pinch(from, to)`     | 把两点映射到另两点的相似变换                                        |
| `decompose(matrix)`   | 拆成 `Parts { translation, scale, rotation, skew }`                 |
| `compose(parts)`      | 由 `Parts` 合成,等价于 `translate · rotate · skew · scale` 依次相乘 |

### 仅 `space`

| 成员           | 说明                 |
| -------------- | -------------------- |
| `lift(matrix)` | 把二维仿射提升为三维 |

## 行为说明

- **退化不抛异常**:行列式为 0 时 `invert` 返回 `undefined`(同 nalgebra 的 `try_inverse`);零长度旋转轴按
  CSS `rotate3d()` 的规定不旋转,得到 `identity`。
- **透视除法**:`space.apply` 按齐次分量 `w` 做除法;`w` 为 0 时跳过除法(同 nalgebra),避免产生无穷大。
- **分解的约定**:`decompose` 把反射归入 `scale.y`(`scale.x` 恒非负);退化矩阵的旋转与斜切取 0。
- **`pinch` 的退化**:起始两点重合时退化为纯平移。
- **只有输入不合法才抛异常**:`from` 与 `parse` 的元素个数不符抛 `RangeError`,其余文本格式错误抛 `SyntaxError`;
  `parse` 忽略大小写与首尾空白。批量 `apply` 的坐标个数须是维数的整数倍,`target` 须与之等长。
- **输出文本**:`format` 直接输出数字的字符串形式,可能含科学计数法(CSS 合法);需要整洁输出时先 `round`,
  它同时把取整得到的 `-0` 规范为 `0`。

## 实现要点

- tsconfig 继承 `@openconsole/tsconfig/strict`,含 `noUncheckedIndexedAccess`
  与 `exactOptionalPropertyTypes`。
- **没有类型断言**:不含任何 `as`。矩阵是定长元组,固定下标与解构都得到 `number`,运算内核无需 `!`;
  `!` 只出现在 `from`、`equals` 与批量循环读取 `Float64Array` 处,断言的都是长度已知的下标。
- `space.multiply` 把外矩阵依次作用于内矩阵的四列,列结果以元组展开拼接,类型上仍是 16 元组。
- **`identity` 不冻结**:冻结数组在 V8 中的元素类型与普通数组不同,一旦流入乘法等内核,元素读取随之退化,
  实测慢数倍;只读由类型保证。
- **契约由编译器校验**:`index.ts` 以 `satisfies Algebra<Matrix, Point>` 登记每个组合,
  共有成员的签名一旦漂移,`tsc` 即报错。

## 模块边界

```
index.ts       - 导出各组合,并以 satisfies 登记到契约
core/
├── algebra.ts - 各组合共享的契约 Algebra
├── values.ts  - 读取 CSS 函数参数、按小数位取整(内部)
├── plane.ts   - 二维仿射
└── space.ts   - 三维射影;依赖 plane 做提升与解析
```

## 开发

```bash
pnpm --filter @openconsole/matrix typecheck  # tsc
```

## License

MIT

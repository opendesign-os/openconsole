# @openconsole/draggable

指针拖拽:以三维矩阵为载体的插件、共享的事件委托,借助 `@openconsole/matrix` 在带变换的容器里精确跟手。

## 特性

- **矩阵载体**:拖拽状态是 `Matrix<3, "projective">`,插件读写矩阵,用 matrix 的函数组合变换
- **CSS `matrix3d` 渲染**:矩阵经 `space.format` 写入 `transform: matrix3d(…)`,插件给出的平移、旋转、缩放都照常渲染;
  初始矩阵取元素当前的 `transform`
- **精确跟手**:合成祖先的 `transform`、`rotate`、`scale` 与元素自身的 `rotate`、`scale` 并求逆,把指针位移换算到
  元素 `transform` 所在的坐标系;有旋转、斜切、缩放时元素仍贴着指针
- **共享委托**:每个 document 只常驻一个 `pointerdown` 监听,拖拽期间才挂 move / up / cancel;指针捕获保证移出元素也不丢
- **合成层加速**:拖拽期间设置 `will-change: transform`,元素提升为合成层,移动只需合成;结束后恢复
- **插件按顺序串联**:`onMove` 返回新矩阵即替换候选变换,后一个插件看到前一个的结果
- 唯一依赖 `@openconsole/matrix`

## 在本仓库中使用

```json
{
  "dependencies": {
    "@openconsole/draggable": "workspace:*"
  }
}
```

## 使用指南

### 基础

```ts
import { Draggable } from "@openconsole/draggable";

const drag = new Draggable(card);

drag.matrix; // 当前变换,初始为元素当前的 transform
drag.dragging; // 是否正在拖拽
drag.destroy(); // 解绑并恢复 touch-action
```

恢复保存的位置:

```ts
import { space } from "@openconsole/matrix";

const drag = new Draggable(card, { matrix: space.translate(120, 80, 0) });
drag.update({ matrix: space.identity }); // 不在拖拽中时立即生效
```

### 插件

插件是普通对象,三个钩子都可选。`onMove` 返回矩阵即替换候选变换,不返回则保持不变:

```ts
import { Draggable, type Plugin } from "@openconsole/draggable";
import { space } from "@openconsole/matrix";

const snap: Plugin = {
  onMove: ({ matrix }) => {
    const x = matrix[12];
    const y = matrix[13];
    return space.multiply(space.translate(Math.round(x / 20) * 20 - x, Math.round(y / 20) * 20 - y, 0), matrix);
  },
};

const save: Plugin = {
  onEnd: ({ matrix }) => localStorage.setItem("card", space.format(matrix)),
};

new Draggable(card, { use: [snap, save] });
```

`m41`、`m42`(下标 12、13)即 x、y 平移。`update({ use })` 从下一次拖拽生效。

### 变换容器

画布缩放、旋转时不需要额外处理:

```ts
viewport.style.transform = "rotate(30deg)";
viewport.style.scale = "1.5";

new Draggable(card); // 指针移动 (dx, dy),卡片在屏幕上同样移动 (dx, dy)
```

## API

### `class Draggable`

| 成员                            | 说明                                                            |
| ------------------------------- | --------------------------------------------------------------- |
| `new Draggable(node, options?)` | 绑定元素,`touch-action` 设为 `none`;传了 `matrix` 立即渲染      |
| `node`                          | 绑定的元素                                                      |
| `matrix`                        | 当前变换(只读)                                                  |
| `dragging`                      | 是否正在拖拽                                                    |
| `update(options)`               | 只写传入的键:`use` 从下一次拖拽生效,`matrix` 在不拖拽时立即渲染 |
| `destroy()`                     | 解绑并恢复原来的内联 `touch-action`;正在拖这个元素时先结束拖拽  |
| `[Symbol.dispose]()`            | 同 `destroy()`,支持 `using`                                     |

### `interface Options`

| 键       | 说明                                    |
| -------- | --------------------------------------- |
| `matrix` | 初始变换,默认取元素计算后的 `transform` |
| `use`    | 插件数组,按顺序执行                     |

### `interface Plugin`

| 钩子               | 时机                                                   |
| ------------------ | ------------------------------------------------------ |
| `onStart(context)` | 按下后第一次移动时                                     |
| `onMove(context)`  | 每次移动;返回 `Matrix<3, "projective">` 即替换候选变换 |
| `onEnd(context)`   | 抬起、取消或 `destroy()` 时                            |

### `interface Context`

| 字段     | 说明                                   |
| -------- | -------------------------------------- |
| `matrix` | 当前候选变换,即元素 `transform` 的矩阵 |
| `origin` | 起拖时的变换                           |
| `node`   | 被拖拽的元素                           |
| `event`  | 当前指针事件;`onStart` 时为按下事件    |

## 行为说明

- **起拖时机**:按下后第一次移动即开始拖拽,位移从按下点算起。只响应主指针的主键(`isPrimary` 且 `button === 0`),
  同一时间只有一个拖拽。
- **嵌套**:沿事件的 `composedPath()` 找最近的已绑定元素,内层优先。
- **文字选中**:拖拽期间根元素设为 `user-select: none`,结束后恢复。
- **`transform` 归 Draggable 管理**:矩阵写入内联 `transform`。元素自身的旋转、缩放请用 `rotate`、`scale` 属性
  (换算时会计入)或放在内层元素上;写在 `transform` 上的会在构造时并入初始矩阵,之后由 Draggable 接管。
  `destroy()` 不清除已写入的 `transform`,元素停在原处。
- **旋转与缩放**:插件返回的线性分量照常渲染,围绕 `transform-origin`(默认是元素中心)。
- **加速**:拖拽期间设置 `will-change: transform`,结束后恢复原值。
- **坐标换算**:对不含透视的变换是精确的;不处理 `perspective`、`zoom` 与 SVG 的 `viewBox`,不支持 iframe 内的元素。
- **click**:拖拽结束后浏览器照常派发 click;起拖阈值与吞掉 click 在后续版本提供。

## 实现要点

- tsconfig 继承 `@openconsole/tsconfig/strict`,不含类型断言 `as`;判断事件目标用 `instanceof`。
- **坐标换算只算线性部分**:位移只受线性部分影响,transform-origin、偏移与滚动都不参与。每个祖先按 CSS 的顺序
  合成 `rotate · scale · transform`,元素自身只计入 `rotate · scale`(`transform` 槽位由 Draggable 写入);
  整条链在三维里合成后用 `space.flatten` 压平,再求逆;奇异时退化为恒等。
- **候选变换**:`space.multiply(space.translate(dx, dy, 0), origin)`,即在 `transform` 所在的坐标系里左乘平移,
  原有的线性分量保持不变。
- **监听**:每个 document 常驻一个 passive 的 `pointerdown`;拖拽期间在 document 捕获阶段挂 move / up / cancel,
  结束即摘;先恢复 `user-select` 与指针捕获,再调用插件的 `onEnd`。

## 模块边界

```
index.ts         - 导出 Draggable 与类型
core/
├── draggable.ts - Draggable、插件调度与渲染
├── pointer.ts   - 指针委托与会话(内部)
└── frame.ts     - 祖先与元素自身的变换 → 客户区到 transform 坐标系的逆线性映射(内部)
```

## 开发

```bash
pnpm --filter @openconsole/draggable typecheck  # tsc
```

## License

MIT

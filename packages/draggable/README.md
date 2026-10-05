# @openconsole/draggable

指针拖拽:开箱即用的网格、可扩展的插件、不依赖 DOM 的跟手逻辑,借助 `@openconsole/matrix` 在带变换的容器里精确跟手。

## 特性

- **开箱即用**:`grid` 选项把拖拽限定在容器内,`snap` 开关吸附,`lines` 开关网格线
- **插件扩展**:一套钩子同时覆盖逻辑(改写矩阵)与界面(挂载、刷新、卸载)
- **逻辑与 DOM 分离**:`Tracker` 只处理点与矩阵,可由指针、键盘、测试或回放驱动,也能用于 canvas;`Draggable` 在其上绑定元素
- **精确跟手**:逐层合成祖先与元素自身的变换并求逆,旋转、斜切、缩放乃至多层 3D 旋转时元素仍贴着指针
- **矩阵载体**:状态是 `Matrix<3, "projective">`,经 `space.format` 写入 `transform: matrix3d(…)`
- 唯一依赖 `@openconsole/matrix`

## 在本仓库中使用

```json
{
  "dependencies": {
    "@openconsole/draggable": "workspace:*"
  }
}
```

## 使用

```ts
import { Draggable } from "@openconsole/draggable";
import { space } from "@openconsole/matrix";

const drag = new Draggable(card, { grid: 20 }); // 在容器里画 20px 网格,不超出容器,吸附到网格
drag.update({ snap: false }); // 只关吸附
drag.update({ lines: false }); // 只关网格线
drag.update({ grid: 0 }); // 关闭网格
drag.update({ matrix: space.translate(120, 80, 0) }); // 直接改位置
drag.destroy();
```

画布缩放、旋转时不需要额外处理:指针移动 (dx, dy),元素在屏幕上同样移动 (dx, dy)。

### 插件

```ts
import { Draggable, type Context, type Plugin } from "@openconsole/draggable";
import { space } from "@openconsole/matrix";

const save: Plugin = {
  onEnd: ({ matrix }) => localStorage.setItem("card", space.format(matrix)),
};

function label(card: HTMLElement): Plugin {
  const show = ({ matrix }: Pick<Context, "matrix">) => {
    card.textContent = `${matrix[12]}, ${matrix[13]}`;
  };
  return { onAttach: show, onMove: show, onUpdate: show };
}

new Draggable(card, { grid: 20, use: [save, label(card)] });
```

- `onMove` 返回矩阵即替换候选变换,插件按 `use` 的顺序串联;`grid` 选项展开的内置插件排在 `use` 之前
- 钩子在渲染之前调用:界面插件读 `context.matrix`,不测量 DOM;需要的元素用闭包传入
- `Plugin` 只读输入的 `x`、`y`;要读事件的其他字段时写 `Plugin<PointerEvent>`
- `m41`、`m42`(下标 12、13)即 x、y 平移

### 脱离 DOM

`Tracker` 是 `Draggable` 内部的纯逻辑:调用方喂入输入,并在起拖时给出 frame,即输入坐标系到矩阵坐标系的线性映射。
`PointerEvent` 的 `x`、`y` 就是 `clientX`、`clientY`,可以直接传入;测试或回放传 `{ x, y }` 即可:

```ts
import { grid, Tracker } from "@openconsole/draggable";
import { plane } from "@openconsole/matrix";

const tracker = new Tracker<PointerEvent>({ use: [grid(20)] });
const frame = plane.invert(plane.linear(view)) ?? plane.identity; // view:场景到客户区的视图矩阵

canvas.addEventListener("pointerdown", (event) => tracker.start(event, frame));
canvas.addEventListener("pointermove", (event) => {
  if (!tracker.dragging) return;
  tracker.move(event);
  draw(tracker.matrix);
});
canvas.addEventListener("pointerup", (event) => tracker.end(event));
```

## API

### `class Draggable`

| 成员                            | 说明                                                           |
| ------------------------------- | -------------------------------------------------------------- |
| `new Draggable(node, options?)` | 绑定元素,`touch-action` 设为 `none`;传了 `matrix` 立即渲染     |
| `node`                          | 绑定的元素                                                     |
| `matrix`                        | 当前变换(只读)                                                 |
| `dragging`                      | 是否正在拖拽                                                   |
| `update(options)`               | 语义同 `Tracker.update`;`matrix` 生效后立即渲染                |
| `destroy()`                     | 解绑、卸载插件并恢复原来的内联 `touch-action`;正在拖拽时先结束 |
| `[Symbol.dispose]()`            | 同 `destroy()`,支持 `using`                                    |

`options` 为 `DraggableOptions`,在 `Options<PointerEvent>` 上增加:

| 键      | 说明                                                                       |
| ------- | -------------------------------------------------------------------------- |
| `grid`  | 网格步长;大于 0 时把拖拽限定在 `offsetParent` 内,为 0 或不传时关闭整个网格 |
| `snap`  | 是否吸附到网格,默认 `true`                                                 |
| `lines` | 是否在 `offsetParent` 里画网格线,默认 `true`                               |

`snap`、`lines` 只在 `grid` 大于 0 时生效;`update` 时除 `matrix` 外传入任一项都会重新组合内置插件。

### `class Tracker<E>`

`E` 为输入类型,须满足 `Point<2>`,默认 `Point<2>`。

| 成员                    | 说明                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `new Tracker(options?)` | 挂载 `use` 中的插件                                                                                                 |
| `matrix`                | 当前变换(只读)                                                                                                      |
| `dragging`              | 是否正在拖拽                                                                                                        |
| `start(event, frame?)`  | 开始拖拽,`frame` 默认恒等                                                                                           |
| `move(event)`           | 经 `frame` 换算相对起点的位移,左乘到起拖矩阵上,再依次交给插件                                                       |
| `end(event)`            | 结束拖拽                                                                                                            |
| `update(options)`       | 只写传入的键:`use` 不拖拽时立即替换,拖拽中在结束后替换;`matrix` 不拖拽时生效并通知插件;同时传入时先替换插件再改矩阵 |
| `destroy()`             | 卸载全部插件;正在拖拽时直接丢弃,不调用 `onEnd`                                                                      |

`Options<E>`:`matrix` 为初始变换,`Tracker` 默认 `space.identity`,`Draggable` 默认取元素当前的 `transform`;`use` 为插件数组。

### `interface Plugin<E>`

| 钩子                | 时机                                                |
| ------------------- | --------------------------------------------------- |
| `onAttach(context)` | 挂上宿主时;`context` 只含 `matrix`                  |
| `onStart(context)`  | 开始拖拽;`Draggable` 中为按下后第一次移动           |
| `onMove(context)`   | 每次移动;返回矩阵即替换候选变换                     |
| `onEnd(context)`    | 结束拖拽;`Draggable` 中为抬起、取消或 `destroy()`   |
| `onUpdate(context)` | `update({ matrix })` 生效后;`context` 只含 `matrix` |
| `onDetach()`        | 从宿主卸下时                                        |

替换插件时只卸载被移除的、挂载新增的;同一个插件实例可以挂到多个宿主,挂载、卸载钩子按宿主各调用一次。

### `interface Context<E>`

| 字段     | 说明                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| `matrix` | 当前候选变换                                                                                                     |
| `origin` | 起拖时的变换                                                                                                     |
| `frame`  | 起拖时的线性映射,输入位移 → 矩阵坐标系的位移;等比缩放时屏幕上 1 像素对应 `Math.hypot(frame[0], frame[1])` 个单位 |
| `event`  | 当前输入;`onStart` 时为起点                                                                                      |

### 内置插件

| 插件                         | 说明                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `grid(step)`                 | 把平移 `m41`、`m42` 对齐到 `step` 的整数倍                                                                   |
| `bounds(measure)`            | 把平移限定在 `measure()` 返回的 `Bounds { left, top, right, bottom }` 内,每次开始拖拽时测量;放在 `grid` 之后 |
| `gridlines(container, step)` | 挂载时在定位元素 `container` 里铺一层网格线,颜色取 `currentColor`;同一容器、同一步长只画一层                 |

`grid` 选项按 `grid`(`snap` 为真时)、`bounds`、`gridlines`(`lines` 为真时)的顺序挂上内置插件,范围按 `offsetParent` 测量。

## 行为说明

- **起拖时机**:按下后第一次移动即开始,位移从按下点算起;只响应主指针的主键,同一时间只有一个拖拽
- **嵌套**:沿 `composedPath()` 找最近的已绑定元素,内层优先
- **文字选中与原生拖放**:起拖时清除选区,拖拽中选区一变化就再清除;按下期间阻止 `dragstart`
- **`transform` 归 Draggable 管理**:矩阵写入内联 `transform`;元素自身的旋转、缩放请用 `rotate`、`scale` 属性(换算时计入),
  写在 `transform` 上的在构造时并入初始矩阵;`destroy()` 不清除已写入的 `transform`
- **加速**:拖拽期间设置 `will-change: transform`,结束后恢复原值
- **坐标换算**:不处理 `perspective`、`transform-style: preserve-3d`、`zoom` 与 SVG 的 `viewBox`,不支持 iframe 内的元素
- **click**:拖拽结束后浏览器照常派发 click;起拖阈值与吞掉 click 在后续版本提供
- **调用顺序**:未开始时的 `move`、`end` 与拖拽中重复的 `start` 都被忽略

## 实现要点

- tsconfig 继承 `@openconsole/tsconfig/strict`,不含类型断言 `as`
- **分层**:`tracker.ts`、`plugins/grid.ts`、`plugins/bounds.ts` 不引用 DOM,测试在 Node 中运行;`draggable.ts` 接线指针、frame 与渲染
- **坐标换算**:每个元素按 CSS 的顺序合成 `rotate · scale · transform`(元素自身不计 `transform`),压平后再与外层相乘,对应默认的
  `transform-style: flat`;整条链求逆,奇异时退化为恒等。只解析计算值的规范形式:角度为 `deg`,`scale` 为数字
- **候选变换**:`space.multiply(space.translate(dx, dy, 0), origin)`,在 `transform` 所在坐标系左乘平移,线性分量不变
- **监听**:每个 document 常驻一个 passive 的 `pointerdown`;按下后的 move / up / cancel / `dragstart` / `selectionchange`
  共用一个 `AbortController`,结束时一次摘除

## 模块边界

```
index.ts         - 导出 Draggable、Tracker、内置插件与类型
core/
├── tracker.ts   - Tracker:点 → 矩阵与插件调度
├── draggable.ts - Draggable:绑定元素,展开 grid 选项
├── pointer.ts   - 指针委托与会话(内部)
└── frame.ts     - 祖先与元素自身的变换 → 逆线性映射(内部)
plugins/
├── bounds.ts    - 限定范围
├── grid.ts      - 网格吸附
└── gridlines.ts - 网格线
examples/        - 示例(独立的 workspace 包),按框架分目录
```

## 开发

```bash
pnpm --filter @openconsole/draggable check         # tsc + vitest run
pnpm --filter @openconsole/draggable test
pnpm --filter @openconsole/draggable-examples dev  # 示例,http://localhost:5173
```

示例由 Vite 开发服务器按需转译包里的 TypeScript 源码。新增框架时在 `examples/` 下建同名目录,并在 `examples/index.html` 加上链接。

## License

MIT

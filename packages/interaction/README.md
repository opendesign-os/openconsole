# @openconsole/interaction

指针交互:拖拽、放置、调整尺寸、排序、旋转、平移缩放(协作在规划中)。所有能力共用一个状态模型与一套矩阵换算,借助 `@openconsole/matrix` 在带变换的容器里精确跟手。

## 特性

- **六项能力**:`Draggable`、`Rotatable`、`Resizable`、`Zoomable`、`Droppable`、`Sortable`,都是 `bind` 的预设
- **统一状态**:`State { matrix, size, index? }`,所有能力、所有插件读写同一种状态
- **统一输入**:指针(最多两指)、键盘、滚轮与程序调用都换算成同一种输入,经矩阵引擎进入容器空间
- **精确跟手**:祖先带旋转、斜切、非等比缩放时,拖拽、旋转、双指与调整尺寸仍贴着指针
- **可扩展**:动作(`Action`)、插件(`Plugin`)、旁观者(`observe`)与渲染(`render`)都可替换
- **无障碍**:键盘抓取与移动、Esc 取消,排序提供非拖拽的 `move()`
- **逻辑与 DOM 分离**:`core/` 不依赖 DOM,在 Node 中测试;导入时不访问 DOM
- 唯一依赖 `@openconsole/matrix`

## 在本仓库中使用

```json
{
  "dependencies": {
    "@openconsole/interaction": "workspace:*"
  }
}
```

## 使用

### 拖拽

```ts
import { Draggable } from "@openconsole/interaction";
import { plane } from "@openconsole/matrix";

const drag = new Draggable(card, { container: board, grid: 20 }); // 限定在 board 内,画 20px 网格并吸附
drag.handle(title); // 只能从标题栏拖
drag.ignore(badge); // 标题栏里的徽标不触发
drag.update({ snap: false }); // 只关吸附
drag.update({ matrix: plane.translate(120, 80) }); // 直接改位置(容器坐标)
drag.destroy();
```

### 旋转、调整尺寸

同一节点可以同时挂多项能力,它们共享一份状态:

```ts
import { Resizable, Rotatable } from "@openconsole/interaction";

new Rotatable(card, { handle: grip, step: Math.PI / 12 }); // 拖 grip 绕中心旋转,吸附 15°
new Resizable(card, {
  handles: new Map([
    [right, { x: 1, y: 0 }],
    [corner, { x: 1, y: 1 }],
  ]),
  container: board,
  width: { min: 60 },
}); // 拖手柄调整尺寸,对边保持不动,旋转后同样成立
```

### 平移缩放

```ts
import { Zoomable } from "@openconsole/interaction";

new Zoomable(world, { viewport, scale: { min: 0.25, max: 4 } }); // 拖视口平移,滚轮或双指绕指针缩放
```

`world` 里的元素照常挂 `Draggable`,缩放后仍贴着指针;按下点落在元素上时元素优先。

### 放置与排序

```ts
import { Droppable, Sortable } from "@openconsole/interaction";

const list = new Sortable(ul, {
  onSort: ({ item, from, to }) => console.log(item, from.index, to.index),
});
new Droppable(trash, {
  onDrop: ({ node }) => {
    node.remove();
    list.refresh();
  },
});
list.move(item, 0); // 不拖拽也能排序
```

### 句柄与排除区

句柄决定从哪里按下才开始,排除区决定从哪里按下不开始;参照 neodrag v3 的规则:

- 通过 `handle`、`ignore` 选项,或 `binding.handle(element, { priority })`、`binding.ignore(element, { priority })` 登记;
  后两者返回注销函数,可直接用作框架的 ref 回调
- 沿 `composedPath()` 由内向外,最内层的标记决定;外层标记的 `priority` 更高时可以覆盖内层
- 没有登记句柄时整个节点都是句柄;登记后只有句柄内的按下才开始,注销到一个不剩时恢复为整个节点
- 被排除或不在句柄上的按下会继续交给外层的绑定,例如画布里卡片正文上的按下会平移画布;输入框、按钮等交互元素上的按下始终不触发

## 状态与坐标

```ts
interface State {
  readonly matrix: Matrix<2, "affine">; // 局部边框盒(左上为原点)→ 容器空间
  readonly size: Size; // 边框盒宽高
  readonly index?: number; // 在所属列表中的位置,只有可排序的节点才有
}
```

- **容器空间**:节点 `offsetParent` 的内边距盒,左上为原点;网格、范围与网格线都在这里对齐
- **接管节点**:首次接管时把计算样式中的 `transform-origin`、`translate`、`rotate`、`scale` 与 `transform` 按规范顺序折叠进矩阵,
  随后清除这几项并设 `transform-origin: 0 0`;此后几何只由矩阵决定,不再从 DOM 读回
- **渲染**:状态升为 4×4 后写入 `transform: matrix3d(…)`,即 `T(−offset)·matrix`;三维变换让节点常驻独立的合成层,由 GPU 合成;尺寸变化时同时写 `width` 与 `height`(按 `box-sizing` 换算)
- **布局移动**:会话开始时若节点的布局位置变了,保持视觉位置不跳

## 动作

动作把输入的移动换算成新状态,并声明自由度:

```ts
interface Action {
  readonly freedom: Freedom; // translate、rotate、scale、edges、pivot
  solve(origin: State, from: readonly Point<2>[], to: readonly Point<2>[]): State;
}
```

| 工厂                                             | 说明                                                                             |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| `transform({ translate, rotate, scale, pivot })` | 一点平移;两点按 `plane.pinch` 求相似变换;单指旋转以支点为虚拟第一点;按自由度投影 |
| `resize({ handle, symmetric })`                  | `handle` 的 `x`、`y` 取 -1、0、1;对边钉住;`symmetric` 时以中心为锚点             |

- 点先经 frame 换到容器空间再求解,所以祖先的任何仿射变换都不影响跟手
- 允许平移时锚点取起始质心,否则取支点(默认为盒中心)
- 缩放只允许等比;非等比的变化由 `size` 表达
- 插件链之后,调整尺寸按最终尺寸重新钉住对边,插件改不坏动作

## 插件

```ts
interface Plugin {
  onAttach?(context: { state }): void;
  onStart?(context: Context): void;
  onMove?(context: Context): State | void; // 返回状态即替换候选
  onEnd?(context: Context): void;
  onCancel?(context: Context): void;
  onChange?(context: { state }): void; // 每次提交后一次:移动、nudge、update、cancel
  onDetach?(): void;
}
```

| `Context` 字段 | 说明                                      |
| -------------- | ----------------------------------------- |
| `state`        | 当前候选                                  |
| `origin`       | 会话起点                                  |
| `previous`     | 上一次提交的状态                          |
| `frame`        | 屏幕 → 容器空间的仿射映射                 |
| `anchor`       | 旋转、缩放保持不动的点(容器空间)          |
| `action`       | 当前动作,插件按 `action.freedom` 决定行为 |
| `input`        | 当前输入:`points`、`modifiers`、`event`   |

内置插件按自由度处理,自定义动作也适用:

| 插件                               | 说明                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| `grid(step)`                       | 能平移时把平移吸附到步长;调整尺寸时把移动边的尺寸吸附到步长                      |
| `bounds(measure)`                  | 包围盒须待在 `measure()` 返回的区域内:能平移就推回,调整尺寸就夹边,否则退回上一步 |
| `limits({ width, height, scale })` | 夹住移动边的尺寸;能缩放时绕 `anchor` 夹住缩放                                    |
| `angle(step)`                      | 能旋转时把角度吸附到步长(弧度),绕 `anchor`                                       |
| `gridlines(container, step)`       | 在容器里铺一层网格线;同一容器、同一步长只画一层                                  |

能力组合内置插件的顺序固定为 `grid → 用户插件 → bounds → limits`,用户插件不会把元素推出范围。

## 扩展

### `bind` 与 `observe`

所有能力都只是 `bind` 的预设;新能力用同一接口编写:

```ts
import { bind, observe, transform } from "@openconsole/interaction";

const binding = bind(node, {
  action: transform({ translate: true, rotate: true, scale: true }),
  activation: (type) => (type === "touch" ? { delay: 250, tolerance: 5 } : { distance: 3 }),
});

const stop = observe({ onMove: ({ node, state, input, data }) => {} }); // 旁观所有会话
```

| `bind` 选项                              | 说明                                                       |
| ---------------------------------------- | ---------------------------------------------------------- |
| `action`                                 | 动作                                                       |
| `handle`                                 | 句柄,默认为节点本身;命中元素与变换元素可以不同             |
| `ignore`                                 | 排除区                                                     |
| `plugins`                                | 插件                                                       |
| `activation`                             | 起动条件:`distance`,或 `delay` + `tolerance`;可按指针类型  |
| `priority`                               | 句柄与排除区的默认优先级,也决定同一元素上多个绑定的先后    |
| `keys`                                   | 键盘映射:键名或 `Shift+键名` → `Step` 或返回 `Step` 的函数 |
| `render`                                 | 替换默认的 CSS 写入                                        |
| `data`                                   | 交给旁观者的载荷,放置时可读                                |
| `matrix`、`size`、`index`                | 初始状态                                                   |
| `signal`                                 | 中止时自动销毁                                             |
| `onStart`、`onMove`、`onEnd`、`onCancel` | 会话回调                                                   |

`Binding` 提供 `state`、`active`、`start(input)`、`move(input)`、`nudge(step)`、`end(input?)`、`cancel()`、`refresh()`、
`relayout()`、`use(plugins)`、`update(options)`、`handle(element, options?)`、`ignore(element, options?)`、`destroy()`
与 `[Symbol.dispose]()`。手柄、笔或回放等自定义输入直接调用这些方法。

### 输入与步进

```ts
interface Input {
  readonly points: readonly Point<2>[]; // 屏幕坐标
  readonly modifiers?: Modifiers;
  readonly event?: Event;
  readonly timestamp?: number;
}
interface Step {
  readonly matrix: Matrix<2, "affine">;
  readonly space: "screen" | "container" | "local";
}
```

键盘与滚轮给 `Step`:一次直接给出的变换,按所在空间换算后作用到当前状态。

### 脱离 DOM

`Tracker` 是不依赖 DOM 的流水线,可用于 canvas、测试与回放;`frame` 为屏幕 → 状态所在空间的仿射映射:

```ts
import { grid, Tracker } from "@openconsole/interaction";
import { plane } from "@openconsole/matrix";

const tracker = new Tracker().use(grid(20));
const frame = plane.invert(view) ?? plane.identity; // view:场景到客户区的视图矩阵

canvas.addEventListener("pointerdown", (event) => tracker.start({ points: [event] }, frame));
canvas.addEventListener("pointermove", (event) => {
  if (!tracker.active) return;
  tracker.move({ points: [event] });
  draw(tracker.state);
});
canvas.addEventListener("pointerup", () => tracker.end());
```

## API

### 能力

| 能力                                     | 选项(另含 `bind` 的通用选项)                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `new Draggable(node, options?)`          | `container`(限定范围并画网格线)、`grid`(步长)、`snap`(默认 `true`)、`lines`(默认 `true`) |
| `new Rotatable(node, { handle, ... })`   | `pivot`(局部点,默认中心)、`step`(角度吸附,弧度)                                          |
| `new Resizable(node, { handles, ... })`  | `handles: Map<Element, Handle>`、`symmetric`、`width`、`height`(范围)、`container`       |
| `new Zoomable(world, { viewport, ... })` | `wheel`(默认 `true`)、`rotate`(默认 `false`)、`scale`(默认 0.1~8)、`speed`               |
| `new Droppable(zone, options?)`          | `accept`、`detect`(默认 `within`)、`onEnter`、`onOver`、`onLeave`、`onDrop`              |
| `new Sortable(list, options?)`           | `items`、`handle`、`ignore`(都是选择器)、`slot`(默认 `closest`)、`duration`、`onSort`    |

- 能力都提供 `destroy()` 与 `[Symbol.dispose]()`;`Draggable`、`Rotatable`、`Resizable`、`Zoomable` 提供 `state`、`active`
  与 `update`,前两者另有 `use`,`Draggable` 另有 `handle` 与 `ignore`;`Sortable` 提供 `items`、`move` 与 `refresh`
- `Droppable` 的 `detect(zone, drag)` 返回分数或 `undefined`;命中多个时最内层优先,其次分数高者;`drag.point` 为指针,
  没有指针(键盘)时为被拖元素的中心
- `Sortable` 的 `slot(point, boxes)` 在容器空间里返回插入位置;事件为 `{ item, from: { list, index }, to: { list, index } }`;
  `move(item, index)` 程序化排序;`refresh()` 在增删条目后重新绑定

### 默认键盘

聚焦 handle 后按 Space 或 Enter 抓取,再按一次放下,Esc 取消;handle 不可聚焦时自动设 `tabindex="0"`。

| 能力        | 按键                                              |
| ----------- | ------------------------------------------------- |
| `Draggable` | 方向键按网格步长(无网格时 1px)移动,Shift 为 10 倍 |
| `Rotatable` | 左右方向键按 `step`(默认 1°)旋转,Shift 为 15 倍   |
| `Zoomable`  | `+`、`-` 以视口中心缩放,方向键平移                |
| `Sortable`  | 方向键移到相邻条目的位置                          |

## 行为说明

- **容器**:`Draggable`、`Resizable` 的 `container` 须是 `node` 的 `offsetParent`;`Zoomable` 的 `viewport` 须是 `world` 的 `offsetParent`
- **起动**:默认按下后第一次移动即开始,位移从按下点算起;`Sortable` 默认鼠标移动 3px、触屏长按 250ms 后开始
- **路由**:沿 `composedPath()` 由内向外找第一个接受这次按下的句柄,同一元素上按 `priority`;规则见"句柄与排除区"
- **两指**:动作允许旋转或缩放时,第二根手指加入同一会话;点数变化时重新取锚,不跳
- **结束与取消**:抬起结束;Esc、`pointercancel` 或会话中 `destroy()` 取消并回到起点;拖动后吞掉随后的 click
- **滚动**:会话中滚动时重新测量并重放最后一次输入
- **文字选中与原生拖放**:起拖时清除选区,拖拽中选区一变化就再清除;按下期间阻止 `dragstart`
- **同一节点同一时间只有一个会话**;同一节点上的多项能力共享状态,任何一项提交都会通知其他能力的插件
- **CSS 冲突**:内联 `transform` 会覆盖 `:hover { transform }`;`transition: transform` 会让拖动滞后
- **不支持**:`perspective`、`transform-style: preserve-3d`、CSS `zoom`、iframe 内的元素;`offsetLeft` 为整数,范围可能有不到 1px 的误差

## 实现要点

- tsconfig 继承 `@openconsole/tsconfig/strict`,不含类型断言 `as`
- **frame**:祖先链的线性部分 `L` 逐级合成(跳过 `display: inline` 的祖先,穿过 shadow root),平移部分由包围盒中心求出:
  `P = [L | s − L·c]`,`c` 为 `matrix` 作用后的盒中心,`s` 为 `getBoundingClientRect` 的中心;`F = P⁻¹`
- **投影**:`G' = T(a + [平移]τ)·R([旋转]θ)·S([缩放]k)·T(−a)`,`τ = G(a) − a`
- **钉住**:`matrix = B·T(fx·(w₀ − w), fy·(h₀ − h))`,只动一侧时对侧的 `f` 为 1 或 0,对称时为 ½
- **监听**:每个 document 常驻一个捕获阶段、passive 的 `pointerdown` 与一个 `keydown`;按下后的监听共用一个
  `AbortController`,结束时一次摘除

## 模块边界

```
index.ts            - 公开 API:core、dom 显式列出,capabilities、plugins 整体转发
core/               - 不依赖 DOM
├── index.ts        - 汇总本目录全部导出,供包内其他目录引用
├── state.ts        - State、Patch、Bounds、merge、corners、extent、center
├── action.ts       - Action、Freedom、transform、resize
├── tracker.ts      - Tracker:候选 → 插件 → 提交
├── style.ts        - 计算样式 → 矩阵(fold,内部)
└── frame.ts        - 屏幕 ↔ 容器空间(内部)
dom/
├── index.ts        - 汇总本目录全部导出,供包内其他目录引用
├── bind.ts         - bind、observe、Binding
├── model.ts        - 每个节点一份状态:折叠、渲染、会话锁、同步(内部)
├── router.ts       - 指针路由、句柄与排除区(内部)
├── keyboard.ts     - 键盘(内部)
├── wheel.ts        - 滚轮(内部)
└── measure.ts      - DOM 测量(内部)
capabilities/       - index.ts 汇总:draggable、rotatable、resizable、zoomable、droppable、sortable
plugins/            - index.ts 汇总:grid、bounds、limits、angle、gridlines
examples/           - 示例(独立的 workspace 包),按框架分目录
```

子目录各自由 `index.ts` 集中导出;跨目录一律从子目录的 `index.ts` 导入,同一目录内直接引用文件。
根 `index.ts` 决定公开范围:内部模块(样式折叠、frame、模型、路由、键盘、滚轮、测量)不对外导出。

## 开发

```bash
pnpm --filter @openconsole/interaction check         # tsc + vitest run
pnpm --filter @openconsole/interaction test
pnpm --filter @openconsole/interaction-examples dev  # 示例,http://localhost:5173
```

示例由 Vite 开发服务器按需转译包里的 TypeScript 源码;`vanilla/` 下有画板(拖拽、旋转、调整尺寸)、画布(平移缩放)
与列表(排序、放置)三页。新增框架时在 `examples/` 下建同名目录,并在 `examples/index.html` 加上链接。

## License

MIT

# @openconsole/interaction

指针交互:拖拽、放置、调整尺寸、排序、旋转、平移缩放、磁贴与嵌套编辑。所有能力共用一个状态模型与一套矩阵换算,借助 `@openconsole/matrix` 在带变换的容器里精确跟手。

## 特性

- **八项能力**:`Draggable`、`Rotatable`、`Resizable`、`Zoomable`、`Droppable`、`Sortable`、`Tileable`、`Nestable`,共用一份约定,
  建立在 `bind` 与 `observe` 之上
- **开箱即用**:不传手柄时自动生成调整尺寸与旋转的手柄;磁吸、碰撞一个开关即可;拖进或拖出容器只需一个选择器
- **统一状态**:`State { matrix, size, index? }`,所有能力、所有插件读写同一种状态
- **统一输入**:指针(最多两指)、键盘、滚轮与程序调用都换算成同一种输入,经矩阵引擎进入容器空间
- **精确跟手**:祖先带旋转、斜切、非等比缩放时,拖拽、旋转、双指与调整尺寸仍贴着指针
- **磁吸与碰撞**:贴边、居中与等间距吸附并显示参考线;碰撞做扫掠检测,快速拖动也不会穿过,撞上后沿障碍物滑动,
  旋转、缩放与调整尺寸停在接触处;嵌套、旋转的容器之间同样精确
- **放置判定**:与 dnd-kit 的碰撞检测对应,内置指针落入(`within`)、相交比例(`overlap`)与中心最近(`nearest`)
- **可扩展**:动作(`Action`)、插件(`Plugin`)、旁观者(`observe`)与渲染(`render`)都可替换
- **无障碍**:键盘抓取与移动、Esc 取消,排序提供非拖拽的 `move()`
- **逻辑与 DOM 分离**:`model/`、`core/` 与 `plugins/` 不引用任何 DOM API 或类型,可在 Node 中运行;读写 DOM 只在 `dom/`,`capabilities/` 负责组装;导入时不访问 DOM
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

const drag = new Draggable(card, {
  container: board, // 限定在 board 内
  grid: 20, // 画 20px 网格并吸附
  handle: title, // 只能从标题栏拖
  ignore: badge, // 标题栏里的徽标不触发
});
drag.update({ grid: 10 }); // 只改传入的选项
drag.assign({ matrix: plane.translate(120, 80) }); // 写状态:直接改位置(容器坐标)
drag.destroy();
```

### 旋转、调整尺寸

同一节点可以同时挂多项能力,它们共享一份状态:

```ts
import { Resizable, Rotatable } from "@openconsole/interaction";

new Rotatable(card, { step: Math.PI / 12 }); // 自动在上方生成旋转把手,吸附 15°
new Resizable(card, { container: board, width: { min: 60 } }); // 自动生成 8 个手柄,对边保持不动,旋转后同样成立
```

自定义手柄用 `Rotatable` 的 `handle` 与 `Resizable` 的 `handles: Map<Element, Handle>`;自动生成的手柄带 `data-layer="grip"`,
颜色取 CSS 变量 `--grip`。

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

### 磁吸、碰撞与嵌套

```ts
import { Draggable, transfer } from "@openconsole/interaction";

new Draggable(group, { container: board, magnet: true, collide: true }); // 贴父元素与兄弟元素,互不重叠
new Draggable(card, {
  container: board, // 任意祖先都可以,范围换算到卡片当前所在的空间
  magnet: ".group, .card", // 选择器:在 container 里任意层级取目标
  collide: ".card",
  nest: ".group", // 拖进或拖出分组,松手时移交,视觉位置不跳
});
transfer(card, group); // 程序化移交
```

按下点落在组内卡片上时拖卡片,落在分组空白处时拖分组,卡片随分组移动。拖动时目标容器带 `data-over` 并显示虚线框
(CSS 变量 `--over`);被拖元素连同已定位的祖先一起抬高,不会被其他分组盖住。

### 磁贴布局

对标 react-grid-layout 与 gridstack:拖动或调整尺寸时按网格对齐,碰到的磁贴被推开,空隙按方向紧凑:

```ts
import { Tileable } from "@openconsole/interaction";

const tiles = new Tileable(grid, {
  columns: 12, // 默认 12
  rowHeight: 80, // 默认 80
  gap: 10, // 默认 10
  compact: "vertical", // "vertical"(默认)、"horizontal"、"none"
  collision: "push", // "push"(默认)、"block"、"overlap"
  sizing: "fixed", // "fixed"(默认)、"content"
  tile: (item, index) => ({ width: 4, height: 2 }), // 可给 x、y、fixed;缺 x、y 时放到第一个空位
  onLayout: (layout) => save(layout), // 布局变化后触发,初始布局读 tiles.layout
});
tiles.move(item, { x: 0, y: 0 }); // 程序化移动或改尺寸
```

磁贴里的内容比磁贴高时,`sizing` 决定怎么处理:

- `"fixed"`(默认):尺寸只由网格决定,内容在磁贴里滚动。给内容区 `overflow: auto` 与 `min-height: 0`,让它填满磁贴剩余空间
- `"content"`:高度随内容自适应,对标 gridstack 的 `sizeToContent`。行数取放下内容所需的最少行,内容变多时推开下方磁贴,
  变少时收回;默认手柄换成右边缘,只调宽度,拖动时占位框按新宽度下的内容高度实时变化

### 编辑器

对标 Puck:页面由嵌套的区域组成,组件可以在区域内排序、在区域之间移动、放进组件里的子区域,也可以从面板拖入新组件:

```ts
import { Nestable } from "@openconsole/interaction";

new Nestable(page, {
  zones: ".zone", // 根节点本身也是区域
  items: ".block",
  sources: ".source", // 面板里的条目,拖入时调用 create 生成新组件(默认深拷贝)
  create: (source) => block(source.dataset.type),
  onSort: ({ item, from, to }) => render(),
});
```

区域里的组件可以带 `Tileable` 网格,网格的磁贴里又可以放区域:流式布局与网格磁贴互相嵌套,按下点落在哪一层就拖哪一层。
网格用 `sizing: "content"` 时,内层网格变高会一路撑高外层磁贴;用 `"fixed"` 时内容在磁贴里滚动。流式区域本身就随内容
变高,需要滚动时给区域设高度与 `overflow: auto`。

### 句柄与排除区

句柄决定从哪里按下才开始,排除区决定从哪里按下不开始;参照 neodrag v3 的规则:

- 能力通过 `handle`、`ignore` 选项登记,用 `update` 替换;`bind` 返回的 `Binding` 另有 `handle(element, { priority })`、
  `ignore(element, { priority })`,返回注销函数,可直接用作框架的 ref 回调
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
- **渲染**:状态升为 4×4 后写入 `transform: matrix3d(…)`,即 `T(−offset)·matrix`;三维变换让节点常驻独立的合成层,由 GPU 合成;恰为单位矩阵时写 `none`,静止的条目不额外产生层叠上下文;尺寸变化时同时写 `width` 与 `height`(按 `box-sizing` 换算)
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
  onChange?(context: { state }): void; // 每次提交后一次:移动、nudge、assign、cancel
  // onCancel 被调用时状态已回到起点,插件可以在此基础上再写入
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

| 插件                                    | 说明                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `grid(step)`                            | 能平移时把平移吸附到步长;调整尺寸时把移动边的尺寸吸附到步长                                     |
| `bounds(measure)`                       | 包围盒须待在 `measure()` 返回的区域内:能平移就推回,调整尺寸就夹边,否则退回上一步                |
| `limits({ width, height, scale })`      | 夹住移动边的尺寸;能缩放时绕 `anchor` 夹住缩放                                                   |
| `angle(step)`                           | 能旋转时把角度吸附到步长(弧度),绕 `anchor`                                                      |
| `gridlines(container, step)`            | 在容器里铺一层网格线;同一容器、同一步长只画一层(位于 `dom/`,会创建元素)                         |
| `magnet(targets, { distance, onSnap })` | 能平移时把包围盒的边与中线吸到目标的边与中线,并做等间距吸附;调整尺寸时只吸移动边;键盘移动不吸附 |
| `collide(targets)`                      | 不与目标重叠:平移做扫掠检测并沿障碍物滑动;旋转、缩放与调整尺寸沿动作二分逼近,停在接触处         |

- `targets(context)` 在会话开始时调用一次,返回容器空间里的多边形;`magnet` 的 `distance` 为屏幕像素(默认 5),
  `onSnap` 在参考线变化时收到 `Guide[]`,结束时收到空数组;`collide` 忽略开始时就已重叠的障碍物
- 等间距参照 tldraw 与 Moveable(`snapGap`):相邻且在另一轴上有重叠的两个目标构成一段间距,被拖元素与它们同排时,
  可以吸到两者正中,或在任一侧复制同样的间距
- `Guide` 为 `{ kind, from, to }`:`kind` 为 `"align"`(对齐线)或 `"gap"`(间距段),`from`、`to` 是容器空间里的端点
- DOM 侧用 `outlines(node, targets, root)` 把元素量成多边形:`targets` 为 `true` 时取父元素与兄弟元素,为字符串时在 `root`
  里按选择器查找;先取屏幕坐标,再经 `frame` 换到被拖元素的容器空间,并排除 `node` 自身与后代
- `guides(host, width?)` 把参考线画在 `host()` 返回的元素里,线宽按缩放换算为 `width` 个屏幕像素(默认 1),
  颜色取 CSS 变量 `--guide`,间距段画成虚线,元素带 `data-kind` 便于自定义样式

能力组合内置插件的顺序固定为 `grid → magnet → 用户插件 → bounds → limits → collide`:先吸附,再约束,碰撞最后,
结果总不重叠。

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
| `onStart`、`onMove`、`onEnd`、`onCancel` | 会话回调                                                   |

`Binding` 提供 `state`、`active`、`start(input)`、`move(input)`、`nudge(step)`、`end(input?)`、`cancel()`、`refresh()`、
`update({ action, plugins })`、`assign(patch)`、`handle(element, options?)`、`ignore(element, options?)`、`destroy()`
与 `[Symbol.dispose]()`。手柄、笔或回放等自定义输入直接调用这些方法。`handle`、`ignore` 选项也接受选择器,在节点内查找。

### 输入与步进

```ts
interface Input {
  readonly points: readonly Point<2>[]; // 屏幕坐标
  readonly modifiers?: Modifiers;
  readonly event?: unknown; // 原生事件,按需自行收窄
  readonly timestamp?: number;
}
interface Step {
  readonly matrix: Matrix<2, "affine">;
  readonly space: "screen" | "container" | "local";
}
```

键盘与滚轮给 `Step`:一次直接给出的变换,按所在空间换算后作用到插件约束之后的当前状态,撞到边界后反方向按一次就能离开。

### 脱离 DOM

`Tracker` 是不依赖 DOM 的流水线,可用于 canvas、测试与回放;选项只放 `action` 与 `plugins`(`update` 替换),
状态经 `assign` 写入(会话中不生效);`frame` 为屏幕 → 状态所在空间的仿射映射:

```ts
import { grid, Tracker } from "@openconsole/interaction";
import { plane } from "@openconsole/matrix";

const tracker = new Tracker({ plugins: [grid(20)] }).assign({ size: { width: 80, height: 40 } });
const frame = plane.invert(view) ?? plane.identity; // view:场景到客户区的视图矩阵

canvas.addEventListener("pointerdown", (event) => tracker.start({ points: [event] }, frame));
canvas.addEventListener("pointermove", (event) => {
  if (!tracker.active) return;
  tracker.move({ points: [event] });
  draw(tracker.state);
});
canvas.addEventListener("pointerup", () => tracker.end());
```

多个 `Tracker` 共享同一份状态时用 `Store`:`join` 登记、`lock` 保证同一时间只有一个会话、`commit` 写入并同步给其他 `Tracker`、
`assign` 只在没有会话时写入。DOM 层的 `View` 在 `Store` 之上加了折叠、测量与渲染。

## API

### 能力

所有能力共用一份约定:

| 成员                   | 说明                                                                      |
| ---------------------- | ------------------------------------------------------------------------- |
| `new X(node, options)` | 创建并立即生效                                                            |
| `node`                 | 能力所在的节点                                                            |
| `active`               | 是否有交互正在进行;`Droppable` 为是否有拖拽停在本区域上                   |
| `update(options)`      | 只写传入的选项,随后按当前选项重建;会话中调用会取消当前会话                |
| `refresh()`            | 按当前选项重建,例如增删了子元素之后                                       |
| `destroy()`            | 销毁,可重复调用;另有 `[Symbol.dispose]()`,`options.signal` 中止时同样销毁 |

改变节点几何的 `Draggable`、`Rotatable`、`Resizable`、`Zoomable` 继承 `Shape`,另有 `state`(当前状态)与
`assign(patch)`(写入 `matrix`、`size`;会话中不生效)。选项只放配置,状态只经 `assign` 写入,重建不会改变状态。

| 能力                                     | 选项(另含 `bind` 的通用选项)                                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `new Draggable(node, options?)`          | `container`(限定范围)、`grid`(吸附步长,有 `container` 时画网格线)、`lines`(默认 `true`)、`magnet`、`collide`、`nest`        |
| `new Rotatable(node, options?)`          | `handle`(默认自动生成把手)、`pivot`(局部点,默认中心)、`step`(角度吸附,弧度)                                                 |
| `new Resizable(node, options?)`          | `handles`(默认自动生成 8 个)、`symmetric`、`width`、`height`(范围)、`container`、`magnet`、`collide`                        |
| `new Zoomable(world, { viewport, ... })` | `wheel`(默认 `true`)、`rotate`(默认 `false`)、`scale`(默认 0.1~8)、`speed`                                                  |
| `new Droppable(zone, options?)`          | `accept`、`detect`(默认 `within`)、`onEnter`、`onOver`、`onLeave`、`onDrop`                                                 |
| `new Sortable(list, options?)`           | `items`、`handle`、`ignore`(都是选择器)、`slot`(默认 `closest`)、`duration`、`onSort`                                       |
| `new Tileable(grid, options?)`           | `columns`、`rowHeight`、`gap`、`rows`、`compact`、`collision`、`sizing`、`tile`、`handles`、`items`、`duration`、`onLayout` |
| `new Nestable(root, options?)`           | `zones`、`items`、`handle`、`ignore`、`sources`、`create`、`duration`、`onSort`                                             |

- 事件按角色命名:会话 `onStart`、`onMove`、`onEnd`、`onCancel`;放置区 `onEnter`、`onOver`、`onLeave`、`onDrop`;排序提交 `onSort`
- `magnet`、`collide` 为 `true` 时以父元素与兄弟元素为目标,为字符串时是 `container` 里的选择器;每次会话开始时取一次目标,
  自身与后代自动排除;`nest` 是可放入的容器选择器,松手时指针下最内层的匹配容器(不在其中时为 `container`)接收节点
- `Tileable` 的 `layout` 为当前布局,`move(item, tile)` 程序化移动;固定磁贴(`fixed`)不可拖动也不会被推开;`rows` 限制
  行数,超出的移动被拒绝;不传 `handles` 时每个磁贴自动生成一个调整尺寸手柄,`sizing` 为 `"fixed"` 时在右下角,
  为 `"content"` 时在右边缘。`sizing` 为 `"content"` 时 `tile` 与 `move` 给的高度不生效,固定磁贴保持声明的尺寸,
  超出 `rows` 时不再增高
- `Nestable` 的 `zones` 为当前区域,`items(zone)` 为区域里的组件,`move(item, zone, index)` 程序化移动;拖动时显示插入线,
  松手才移动 DOM,随后组件回到文档流;`onSort` 的 `from` 对新建组件是它在面板里的位置
- `Droppable` 的 `detect(zone, drag)` 返回分数或 `undefined`;命中多个时最内层优先,其次分数高者。`drag.point` 为指针,
  没有指针(键盘)时为被拖元素的中心;`drag.shape` 为被拖元素在屏幕上的多边形
- 内置判定:`within`(指针落在区域内,默认)、`overlap`(交集面积除以并集面积,同 dnd-kit 的 `rectIntersection`)、
  `nearest`(中心距离越近分数越高,同 `closestCenter`)
- `Sortable`、`Tileable`、`Nestable` 共用 `ListOptions`:`items`、`handle`、`ignore` 为选择器,`duration` 为过渡时长(默认 150ms)
- `Sortable` 的 `slot(point, boxes)` 在容器空间里返回插入位置;事件为 `{ item, from: { list, index }, to: { list, index } }`;
  `items` 为当前条目,`move(item, index)` 程序化排序
- 自定义能力继承 `Capability<N, O, U>`(或 `Shape<N, O>`),只实现 `build()`:返回本能力用到的单元 `U`(默认 `Unit`,
  即有 `active` 与 `destroy()` 的对象,如 `Binding`)与清理函数,其余生命周期由基类负责;`Shape` 另接收节点的 `Store`。
  基类属于模型层,不引用 DOM,`N` 为节点类型

### 默认键盘

聚焦 handle 后按 Space 或 Enter 抓取,再按一次放下,Esc 取消;handle 不可聚焦时自动设 `tabindex="0"`。

| 能力        | 按键                                              |
| ----------- | ------------------------------------------------- |
| `Draggable` | 方向键按网格步长(无网格时 1px)移动,Shift 为 10 倍 |
| `Rotatable` | 左右方向键按 `step`(默认 1°)旋转,Shift 为 15 倍   |
| `Zoomable`  | `+`、`-` 以视口中心缩放,方向键平移                |
| `Sortable`  | 方向键移到相邻条目的位置                          |
| `Tileable`  | 方向键移动一格                                    |

## 行为说明

- **容器**:`Draggable`、`Resizable` 的 `container` 可以是任意祖先,区域按节点当前所在的空间换算;`Zoomable` 的 `viewport` 须是 `world` 的 `offsetParent`;`Tileable` 的磁贴须绝对定位于容器左上(`position: absolute; left: 0; top: 0`),容器高度随布局自动调整
- **起动**:默认按下后第一次移动即开始,位移从按下点算起;`Sortable` 默认鼠标移动 3px、触屏长按 250ms 后开始
- **路由**:沿 `composedPath()` 由内向外找第一个接受这次按下的句柄,同一元素上按 `priority`;规则见"句柄与排除区"
- **两指**:动作允许旋转或缩放时,第二根手指加入同一会话;点数变化时重新取锚,不跳
- **结束与取消**:抬起结束;Esc、`pointercancel` 或会话中 `destroy()` 取消并回到起点;拖动后吞掉随后的 click
- **滚动**:会话中滚动时重新测量并重放最后一次输入
- **过渡中抓起**:排序、磁贴与编辑器的 FLIP 过渡带 `id: "flip"`;会话开始时所有过渡直接结束,被抓的元素按它在屏幕上
  看到的位置接住,不会跳离光标
- **文字选中与原生拖放**:起拖时清除选区,拖拽中选区一变化就再清除;按下期间阻止 `dragstart`
- **嵌套**:各层各自挂能力,按下点决定拖哪一层,外层移动时内层跟随。各层状态都在自己的 `offsetParent` 空间里,
  磁吸与碰撞的目标经屏幕坐标换到被拖元素的容器空间,跨层级、带旋转或缩放的容器之间同样精确;祖先可以作磁吸目标
  (贴父级边缘与中线),碰撞时开始就重叠的祖先自然被忽略
- **移交**:`transfer(node, container)` 与 `nest` 选项把节点移到另一个容器,矩阵按 `convert` 换到新容器的空间,屏幕上的
  位置、旋转与尺寸都不变;会话进行中不移交
- **覆盖层**:网格线、参考线、占位框、插入线与自动手柄都带 `data-layer`,不会被当作条目或磁吸目标
- **磁贴内容**:`sizing: "content"` 时增删节点、改文字或属性、图片加载、宽度变化后都会重新量高;本网格的拖动进行中不量,
  松手后统一提交。内容区设了 `overflow: auto` 时,从里面拖出的元素在离开内容区前会被裁剪,因为移动的是元素本身而不是拖影
- **同一节点同一时间只有一个会话**;同一节点上的多项能力共享状态,任何一项提交都会通知其他能力的插件
- **CSS 冲突**:内联 `transform` 会覆盖 `:hover { transform }`;`transition: transform` 会让拖动滞后
- **不支持**:`perspective`、`transform-style: preserve-3d`、CSS `zoom`、iframe 内的元素;`offsetLeft` 为整数,范围可能有不到 1px 的误差

## 实现要点

- tsconfig 继承 `@openconsole/tsconfig/strict`,不含类型断言 `as`
- **frame**:祖先链的线性部分 `L` 逐级合成(跳过 `display: inline` 的祖先,穿过 shadow root),平移部分由包围盒中心求出:
  `P = [L | s − L·c]`,`c` 为 `matrix` 作用后的盒中心,`s` 为 `getBoundingClientRect` 的中心;`F = P⁻¹`
- **投影**:`G' = T(a + [平移]τ)·R([旋转]θ)·S([缩放]k)·T(−a)`,`τ = G(a) − a`
- **钉住**:`matrix = B·T(fx·(w₀ − w), fy·(h₀ − h))`,只动一侧时对侧的 `f` 为 1 或 0,对称时为 ½
- **移交**:`convert(matrix, from, to) = to·from⁻¹·matrix`,`from`、`to` 为移动前后屏幕 → 容器空间的 frame
- **磁贴**:先把被拖磁贴放到目标格,其余磁贴按行(横向紧凑时按列)依次处理;与它重叠的磁贴在它从上方移来时让到它前面,
  放不下再推到后面;随后整体紧凑。以当前预览为基准逐步计算,所以拖过多块磁贴时依次交换
- **内容高度**:把磁贴临时设为目标宽度、`height: auto`,量出自然高度 `h`,行数为 `⌈(h + gap) / (rowHeight + gap)⌉`;
  `MutationObserver` 监听磁贴子树(磁贴自身的 `style` 是渲染写入,忽略),捕获阶段监听 `load`
- **监听**:每个 document 常驻一个捕获阶段、passive 的 `pointerdown` 与一个 `keydown`;按下后的监听共用一个
  `AbortController`,结束时一次摘除

## 模块边界

```
index.ts            - 公开 API:model、core、dom 显式列出,capabilities、plugins 整体转发
model/              - 模型:状态、存储与能力的基类约定,不引用 DOM
├── capability.ts   - Capability、Shape:能力的基类与生命周期
├── geometry.ts     - Span、Range、Bounds、Polygon、Guide 与 extent、centroid、area、scale、contains、intersect
├── state.ts        - State、Patch 与 merge、corners、center
└── store.ts        - Store:共享状态、会话锁、成员之间同步
core/               - 逻辑:不引用 DOM
├── action.ts       - Action、Freedom、transform、resize
├── frame.ts        - 屏幕 ↔ 容器空间
├── order.ts        - 排序:closest 选位置,arrange 给出移动计划,rank 求插入位次
├── tiling.ts       - 磁贴:place、settle、vacant、bottom(推开、紧凑、找空位)
├── tracker.ts      - Tracker:候选 → 插件 → 提交;hotspot 求拖拽热点
└── zone.ts         - 放置:按内外层与分数选出目标
plugins/            - 约束:grid、bounds、limits、angle、magnet、collide(不引用 DOM)
dom/                - 适配:只有这里读写 DOM
├── bind.ts         - bind、observe、Binding
├── gridlines.ts    - 网格线插件
├── grips.ts        - 自动生成的调整尺寸手柄与旋转把手
├── guides.ts       - 参考线与插入线
├── keyboard.ts     - 键盘
├── measure.ts      - 测量:尺寸、矩形、outline(屏幕多边形)、outlines(磁吸与碰撞的目标)、probe(最内层命中)、query(取条目)
├── motion.ts       - FLIP 过渡、抬高、回到布局位置
├── nest.ts         - 拖进或拖出容器
├── router.ts       - 指针路由、句柄与排除区
├── style.ts        - 计算样式 → 矩阵(fold)
├── view.ts         - View:在 Store 之上折叠、测量、渲染;transfer、region、reset
└── wheel.ts        - 滚轮
capabilities/       - 组装:draggable、rotatable、resizable、zoomable、droppable、sortable、tileable、nestable
```

子目录各自由 `index.ts` 集中导出;跨目录一律从子目录的 `index.ts` 导入,同一目录内直接引用文件。
根 `index.ts` 决定公开范围:内部函数(状态合并、移动计划、目标选择、样式折叠、frame、视图、路由、键盘、滚轮、测量)不对外导出。
依赖只朝下:`model/` 不引用其他子目录,`core/` 只引用 `model/`,`plugins/` 与 `dom/` 引用 `core/`、`model/`,`capabilities/` 组装其余各层。

## 开发

```bash
pnpm --filter @openconsole/interaction check  # tsc
```

## License

MIT

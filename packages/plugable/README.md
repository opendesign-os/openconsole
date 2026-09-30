# @openconsole/plugable

通用插件系统内核：图驱动的顺序 + 编译式 hook 派发。Host 无关 —— 同一引擎可驱动任意需要
「可扩展插入点」的系统。

## 四层职责

| 层                    | 负责 | 形态                                                     |
| --------------------- | ---- | -------------------------------------------------------- |
| {@link Pipeline}      | 排序 | 先后声明建图，编译出执行序、可并行分层与诊断             |
| {@link Hook}          | 派发 | 四种策略 × 同异步，计划算一次存着，`call()` 零排序零分配 |
| {@link Ordering}      | 顺序 | 把 `enforce` / `before` / `after` 投影成一条流水线       |
| {@link PluginManager} | 装配 | 作用域 / 热重载 / 跨插件通信 / 错误隔离                  |

插件之间的顺序和一个 hook 内 tap 之间的顺序是同一个问题的两个尺度，共用 `Pipeline` 这一份
实现 —— 桶分别是 `enforce` 与 `stage`。整个包里没有第二份拓扑排序。

设计取自三处：**tapable** 的「派发计划要编译，不要每次现算」、**esbuild** 的「filter 是数据，
引擎在跨进插件之前就判定完」、**rollup / vite** 的 `enforce` 硬分相。

## 安装

```json
{ "dependencies": { "@openconsole/plugable": "workspace:*" } }
```

## 快速开始

### 1. Host 声明 hooks

```ts
import { BailHook, ParallelHook, SeriesHook, WaterfallHook } from "@openconsole/plugable";

export function createBuildHooks() {
  return {
    buildStart: new SeriesHook<{ root: string }>("buildStart"),
    resolveId: new BailHook<{ id: string; importer?: string }, { id: string }>("resolveId"),
    load: new BailHook<{ id: string; namespace?: string }, { code: string }>("load"),
    transform: new WaterfallHook<{ id: string }, { code: string }>("transform"),
    buildEnd: new ParallelHook<{ durationMs: number }>("buildEnd"),
  };
}
export type BuildHooks = ReturnType<typeof createBuildHooks>;
```

### 2. 写插件

```ts
import { definePlugin, Stage, type Host } from "@openconsole/plugable";

const alias = definePlugin<BuildHooks, Host, { entries: Record<string, string> }>({
  name: "alias",
  enforce: "pre",
  setup(api, options) {
    api.hooks.resolveId.tap({ filter: { id: Object.keys(options.entries) } }, ({ id }) => ({
      id: options.entries[id]!,
    }));
  },
});

const stripDebugger = definePlugin<BuildHooks>({
  name: "strip-debugger",
  enforce: "post",
  setup(api) {
    api.hooks.transform.tap({ filter: { id: /\.[jt]sx?$/ }, stage: Stage.post }, (_input, output) => void (output.code = output.code.replace(/\bdebugger;?/g, "")));
  },
});
```

`tap` 不必写 `name` —— 管理器会把它钉成插件名，写别的会被覆盖。tap 的身份就是它的插件，于是
排序权重与卸载分组都不可能因为写错名字而失效。

### 3. Host 装配并派发

```ts
import { PluginManager } from "@openconsole/plugable";

const manager = new PluginManager(createBuildHooks(), { cwd: process.cwd(), mode: "build" });
await manager.use([[alias, { entries: { "@/x": "/abs/x.ts" } }], stripDebugger]);

await manager.hooks.buildStart.call({ root: process.cwd() });
const resolved = await manager.hooks.resolveId.call({ id: "@/x" }); // 熔断：首胜
const loaded = resolved && (await manager.hooks.load.call({ id: resolved.id }));
const out = loaded && (await manager.hooks.transform.call({ id: resolved!.id }, { code: loaded.code }));

await manager.reload("strip-debugger");
console.table([...manager.codes()].map(([name, code]) => ({ name, ...code })));
```

## 派发策略

| 策略            | 同步版              | 语义                   | 典型用途                        |
| --------------- | ------------------- | ---------------------- | ------------------------------- |
| `BailHook`      | `SyncBailHook`      | 首个非空结果胜出、短路 | 解析 / 加载 / 权限（deny 短路） |
| `WaterfallHook` | `SyncWaterfallHook` | 输出顺着 taps 链式改写 | 转换 / 配置 / 参数              |
| `SeriesHook`    | `SyncSeriesHook`    | 串行副作用             | 生命周期 / 事件                 |
| `ParallelHook`  | —                   | 层内并发、层间有序     | 并发收尾                        |

都接 `onError`：给了就交给它（隔离，继续派发），不给就抛出（阻断）。`ParallelHook` 多个 tap
同时失败时聚成 `AggregateError`——全部跑完再统一报错，既不留悬空拒绝，也不静默丢弃。
`WaterfallHook` 隔离一个 tap 时保留上一轮的值，失败的 tap 不污染下游。

### 同步版省掉的是整条微任务链

`Sync*` 的 `call()` 直接返回值，不裹 Promise。每次派发都要跑、且 tap 一定同步的热路径用它 ——
一个被调十万次的 `resolveId` 不该逼着调用侧 `await`：

```ts
const resolveId = new SyncBailHook<{ id: string }, { id: string }>("resolveId");
const resolved = resolveId.call({ id }); // 不是 Promise
```

没有同步版的 `ParallelHook`：并发本身就意味着异步。

把 `async` 函数注册到同步 hook 上，**类型是挡不住的** —— 返回类型 `void` 的函数位置接受任何
返回值。所以运行期点名报错，而不是丢一个没人 `await` 的 Promise（那会让错误以 unhandled
rejection 的形式出现在完全无关的地方）：

```
TypeError: hook "resolveId" 是同步的,tap "oops" 却返回了 Promise
```

## HookMap：按 key 派生

`filter` 与 `HookMap` 解决的是同一件事的两端，**分工看 key 空间**：

|           | 派发一次的代价 | 适合                                           |
| --------- | -------------- | ---------------------------------------------- |
| `filter`  | n 次谓词判断   | 几个条件就分完（`.ts` vs `.css`）              |
| `HookMap` | 一次查表       | key 稀疏且基数大（按命令名 / 事件名 / 扩展名） |

```ts
const hooks = {
  command: new HookMap((key) => new SyncBailHook<Args, Result>(`command:${key}`)),
};

// 插件侧
setup(api) {
  api.hooks.command.for("build").tap({}, run);
}

// host 侧
hooks.command.for("build").call(args);
```

派生是惰性的，新建的 key 自动继承已注入的插件图序与探针，所以插件在 setup 里现开一个 key 也
照样按图序排、照样被 `probe` 观测、照样在卸载时被摘干净。`use()` 会校验已派生的每个 key。

## 一个 hook 的 taps 是一条流水线

不是一个排好的列表。每个 tap 是图上一个节点，`before` / `after` 是边，派发顺序是拓扑序：

```ts
api.hooks.transform.tap({ after: ["banner"] }, handler);
api.hooks.transform.tap({ before: ["minify"], stage: Stage.post }, handler);
```

引用的是**注册名**（经管理器就是插件名），同名的 tap 全部被约束，引用不存在的名字则忽略 ——
于是「可选依赖」不必写条件分支，被引用的插件卸载后那条边自动消失。

这比插件级 `after` 细一档，而且能表达后者根本表达不了的东西：

```ts
// a 要在 transform 上先于 b，却要在 resolve 上后于 b。
// 插件级 after 是全局的，写不出这种反向；每个 hook 各有一条流水线就没问题。
setup(api) {
  api.hooks.transform.tap({ before: ["b"] }, ...);
  api.hooks.resolve.tap({ after: ["b"] }, ...);
}
```

`stage`（数值，越小越先；`Stage.pre` = -10 / `Stage.default` = 0 / `Stage.post` = 10）是硬分相，
比先后声明更粗一档；同桶同层时才轮到插件图序，最后退回注册序。因此插件想在某个 hook 上破格
插到最前，不必去动自己的全局顺序。

### `ParallelHook` 因此是真的流水线

层 = 同 `(stage, layer)` 的一组 tap，组内互不依赖。层内并发、层间等待：

```ts
hook.tap({ name: "a" }, slowTask);
hook.tap({ name: "b" }, quickTask);
hook.tap({ name: "sum", after: ["a", "b"] }, collect); // 等 a、b 都完成
```

谁都没声明先后且 `stage` 相同时只有一层，退化成「全部并发」。`hook.entries()` 会把每个 tap 的
`layer` 一起报出来，能直接看出谁跟谁并发。

### 先后声明会被校验

`manager.use()` 在装配边界上校验每个 hook 的 tap 流水线，连同插件图一起 —— 派发时不再有意外，
失败则整批回滚。诊断和插件级同源：

```
CycleError: hook "transform" 的 tap 顺序成环(强连通分量):
  { x, y }

PhaseError: hook "transform" 的 tap 顺序与分相矛盾:
  late(10) 须先于 early(-10)
```

带环时顺序**降级但不崩塌** —— 环上的 tap 接在无环部分之后，全部照样执行，报错的责任收在
`verify()` 一处。

## 派发计划是编译出来的

`call()` 不排序、不过滤、不分配 —— 只顺序遍历一个已冻结的计划：

- `filter` 在 `tap()` 时就编译成**单个**谓词，热路径上每个 tap 最多付一次判断；无条件的 tap
  连这次判断都没有；
- 计划取一次用整趟：派发途中注册 / 注销的 tap 落到下一次，正在跑的循环不会跳项或重复。

tapable 用代码生成拿到这件事，这里用惰性重编译 —— 没有 `new Function`，也就没有 CSP 与
source map 的麻烦。

**两级缓存对应 graph 区分的两个版本号**：拓扑分析随 `shape`（结构）失效，最终排序随 `revision`
与 `epoch` 失效。于是「又注册了一个插件」只让没被它 tap 的 hook 重排一次数组，不必重连边、
重编译快照、重跑拓扑。

边不是增量连的，而是分析前整体重连一次。tap 是一个个到的，前向引用在到达时对方还不在图里；
整体重连按 `shape` 去重，一批增删只付一次 O(V+E)。

## filter 是数据，不是闭包

这是 esbuild 的做法（`onLoad({ filter: /\.ts$/ })`）。条件写成对象而不是谓词，换来两条：

```ts
api.hooks.transform.tap({ filter: { id: /\.[jt]sx?$/ } }, handler);
api.hooks.load.tap({ filter: { namespace: "virtual", id: ["@/env", "@/version"] } }, handler);
api.hooks.resolveId.tap({ filter: (input) => input.id.length > 40 }, handler); // 逃逸口
```

1. **可自省**：`hook.entries()` 按派发顺序给出 `{ name, stage, layer, filter }`，条件可打印、
   可比较、可序列化 —— 能直接说清「这个 tap 到底管哪些输入」；
2. **可特化**：多字段条件在注册时一次摊平，单字段（绝大多数形态）特化掉数组遍历。

逐字段模式匹配，**全部**命中才算命中；串 = 精确相等，正则 = `test`，数组 = 任一命中。
非字符串字段一律不命中 —— 否则正则会把 `undefined` 强转成 `"undefined"`，那是个静默的错答案。

组合子：`filter.{ and, or, not, test, compile }`。

## 顺序码

每个插件算出 `OrderCode = { bucket, layer, sequence, code }`：

- **`bucket`** — `enforce` 硬分相：`pre`(0) → 默认(1) → `post`(2)；
- **`layer`** — 同相内的依赖深度；同 `(bucket, layer)` 互不依赖 → 可并行 setup；
- **`sequence`** — 全局线性序号，即 setup 顺序与每个 hook 内 tap 的默认权重；
- **`code`** — 形如 `"1.002"`，可读可比较。

### 建模：桶不进图

节点 = 单元（插件或 tap），边 = `before` / `after`，桶不进图 —— 它是一个字典序键。顺序 = 按
`(bucket, layer, tiebreak, 拓扑位次)` 排序，前两项与边同向：同桶内 `u → v` 必有
`layer[v] > layer[u]`，跨桶则桶已定先后。于是一次排序同时满足分相与依赖，而 `sequence` 相邻
的一段恰好就是一个可并行层。

这比拿 barrier 合成节点表达分相换来三件事：图里只有真正的依赖边；分层不必到处过滤 barrier；
分相与依赖矛盾时能**点名**报错，而不是伪装成一个提到 barrier 名字的环。

### 为什么是重算，不是增量

`@openconsole/graph` 有增量拓扑序（`Ordering`），这里刻意没用它。两条理由：

- 这两张图都是「批量改一次、读很多次」，正对上 graph 自己推荐的形态「批量编辑 → 编译一次 →
  跑一批算法」；
- 增量版把成环的边**排除在约束外**以维持可用顺序 —— 那对编辑器是对的，对插件却恰恰是要
  报错的场景。

## 分层并行 setup

`concurrent: true` 让同一 `(bucket, layer)` 的插件并发 setup：

```ts
const manager = new PluginManager(hooks, host, { concurrent: true });
```

**这不会改变任何 hook 的执行顺序** —— 派发次序只由图决定，与谁先 setup 完无关。图在这里付了
两次钱：一次买来顺序，一次买来「并发是安全的」这个保证。

唯一要求：跨插件的 `provide` / `consume` 必须靠 `after` 声明出来，否则同层就是竞态。

## 作用域生命周期

`setup(api)` 拿到的把手绑在一个作用域上，卸载 / 重载时整片回收：

```ts
setup(api) {
  api.hooks.transform.tap({}, handler);  // 自动 un-tap
  api.provide("cache", cache);           // 自动撤下
  api.onDispose(() => server.close());   // 逆序执行
  fetch(url, { signal: api.signal });    // 自动 abort
  api.host.logger?.info(api.name);
  api.has("other-plugin");
}
```

setup 抛错即回滚该插件已注册的一切；首次装配失败还会连登记与图节点一起撤销。

## 观测

`probe` 在每个 tap 执行前调一次，返回的收尾回调在该 tap 结束时调用（出错则带上错误）：

```ts
const manager = new PluginManager(hooks, host, {
  probe: (hook, tap) => {
    const at = performance.now();
    return (error) => void report(hook, tap, performance.now() - at, error);
  },
});
```

这就是 webpack `intercept` 最常被用到的那件事——「哪个插件的哪个 tap 慢 / 抛了」——收成一个
类型。无人设置时热路径上只有一次 `undefined` 判断。

## API

- 排序：`Pipeline` · `Step` · `Plan` · `Placement` · `PipelineOptions` · `Conflict` ·
  `CycleError` · `PhaseError`
- 引擎：`Hook` · `SeriesHook` · `ParallelHook` · `WaterfallHook` · `BailHook` · `HookMap` ·
  `Stage` · `TapOptions` · `TapEntry` · `HookOptions` · `WaterfallOptions` · `Produce` ·
  `Probe` · `OnError` · `Ranking`
- 同步引擎：`SyncSeriesHook` · `SyncWaterfallHook` · `SyncBailHook` · `SyncWaterfallOptions` ·
  `SyncProduce`
- 过滤：`filter.{ test, compile, and, or, not }` · `Filter` · `Match` · `Pattern` · `Predicate`
- 插件：`Plugin` · `Context` · `definePlugin` · `Host` · `Hooks` · `Tappable` · `Logger`
- 顺序：`Ordering` · `Ordered` · `OrderCode` · `Enforce`
- 管理：`PluginManager` · `ManagerOptions` · `Install`
- 加载：`loadPlugin` · `LoadOptions`

## 模块边界

```
core/
├── filter     声明式条件 → 单个谓词
├── pipeline   图驱动顺序原语：Step / Plan / 诊断
├── hook       四种派发策略，taps 建在 pipeline 上
├── order      插件顺序：enforce / before / after → pipeline
├── plugin     Plugin / Context / Host 类型
├── manager    装配、作用域、热重载
└── loader     spec → 动态 import
```

依赖单向：`pipeline` 只认 graph，`hook` 只认 `pipeline` 与 `filter`，`order` 只认 `pipeline`，
`manager` 认全部。`hook` 不认 `order`——插件图序经 `Ranking` 这个接口注入。

## 开发

```bash
pnpm --filter @openconsole/plugable check   # tsc + vitest run
pnpm --filter @openconsole/plugable test
```

## License

MIT

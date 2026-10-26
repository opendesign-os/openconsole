# @openagent/core

与模型无关的图运行时，是 [`@openagent/agent`](../agent) 的下层。一次运行是一张**只追加的 DAG**：每个节点运行一个算子（`Operator`），节点的输入齐了就执行，规划节点能在运行中往图里加节点；暂停、恢复、失败重试和事件流都在这一层，运行过程以只追加的日志写进 `Store`。

## 快速开始

```ts
import { tool, Workflow, type Operator } from "@openagent/core";

const search = tool(async ({ query }) => [`${String(query)} 的结果`], {
  name: "search",
  description: "搜索",
  schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
});

const summarize: Operator = {
  name: "summarize",
  description: "把搜索结果汇总成回答",
  inputSchema: { type: "object", properties: { result: {} } },
  outputSchema: { type: "object", properties: { answer: { type: "string" } } },
  run: async ({ result }) => ({ answer: JSON.stringify(result) }),
};

const flow = new Workflow({ name: "research" }).node("search", search).node("summarize", summarize).edge("search", "summarize");

const run = await flow.run({ query: "graph agents" }, { session: "s1" });
run.output; // { answer: ... }

for await (const event of flow.stream({ query: "agents" })) {
  if (event.type === "finish") console.log(event.node, event.outputs);
}
```

`Agent`（在 `@openagent/agent` 里）和 `Workflow` 都继承 `Runner`，共用下面的运行接口。

## 运行

| 接口                     | 说明                                                                              |
| ------------------------ | --------------------------------------------------------------------------------- |
| `run(input, options)`    | 跑完返回 `Run`                                                                    |
| `stream(input, options)` | 逐个产出 `RunEvent`，最后一个是 `{ type: "end", run }`                            |
| `runs(session)`          | 这个会话的所有运行，按创建先后排序                                                |
| `options`                | `{ session, user, signal, limits }`；`limits` 是 `{ nodes, tokens, concurrency }` |

`Run` 带着 `id`、`session`、`user`、`status`（`running` / `paused` / `completed` / `failed`）、`input`、`output`、`pending`、`usage`、`error`。`output` 是最近一个完成的、输出里声明了 `answer` 端口的节点的输出。

`RunEvent` 是带 `type` 的联合，判断 `type` 后其余字段自动收窄：

| type     | 字段                        | 时机                                    |
| -------- | --------------------------- | --------------------------------------- |
| `start`  | `node`、`operator`          | 节点开始执行                            |
| `finish` | `node`、`outputs`、`cached` | 节点完成；命中缓存时 `cached` 为 `true` |
| `fail`   | `node`、`error`             | 节点失败                                |
| `retry`  | `node`、`attempt`、`error`  | 这次尝试失败，即将重试                  |
| `skip`   | `node`                      | 节点因上游没给值而跳过                  |
| `pause`  | `node`、`value`             | 节点等待恢复                            |
| `grow`   | `by`、`plan`                | 规划节点往图里加了节点                  |
| `delta`  | `node`、`text`              | 节点用 `context.emit` 输出文本          |
| `data`   | `node`、`data`              | 节点用 `context.publish` 输出数据       |
| `usage`  | `node`、`usage`             | 节点记录 token 用量                     |
| `end`    | `run`                       | 这次调用结束                            |

## 暂停与恢复

```ts
const ask: Operator = {
  name: "ask",
  description: "等人回答",
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object", properties: { answer: {} } },
  run: async (_, context) => ({ answer: context.interrupt({ question: "继续吗？" }) }),
};

const paused = await flow.run({}, { session: "s1" }); // paused.status === "paused"，paused.pending[0].id === "ask"
const done = await flow.run({ resume: { ask: "继续" } }, { session: "s1" });
```

- 第一次调用 `context.interrupt(value)` 时节点暂停；恢复时节点从头重跑，这一次 `interrupt` 直接返回恢复值，所以它之前的代码要能安全重复执行。
- `resume` 以节点 id 为键，只恢复给了值的节点，其余的继续等。
- 没有下游的节点失败时，`run` / `stream` 在运行结束后抛出它的原始错误，运行记为 `failed`；之后用 `{ resume: {} }` 重跑这些节点，已完成的节点不重跑。
- 恢复读的是 `Store` 里的日志，所以换一个进程、换一个实例都能接着跑。
- 嵌套的 `Runner` 暂停时，外层节点跟着暂停，`pending` 里的 id 是一条路径，例如 `middle:inner:ask`，恢复时直接用它作键。回答会先写进对应子运行的日志，再唤醒外层节点，子运行从暂停处接着跑。
- 子运行的会话是 `外层运行 id:节点 id`。外层节点因重试或崩溃续跑而重跑时，会接着这个会话里最近一次子运行跑；那次子运行已经完成的话，直接用它的结果。

## 容错与缓存

```ts
const search = tool(({ query }, { signal }) => fetch(`https://example.com/?q=${String(query)}`, { signal }).then((response) => response.json()), {
  name: "search",
  description: "搜索",
  policy: { attempts: 3, timeout: 10_000, cache: 3_600_000 },
});

const flow = new Workflow({ name: "research", policy: { attempts: 2 } }); // 没有自己 policy 的算子都用这一份
```

| `policy` 字段 | 说明                                                              | 默认   |
| ------------- | ----------------------------------------------------------------- | ------ |
| `attempts`    | 最多尝试几次                                                      | 1      |
| `delay`       | 第一次重试前等待的毫秒数，之后每次乘以 `factor`                   | 1000   |
| `factor`      | 退避倍数                                                          | 2      |
| `timeout`     | 单次尝试的毫秒上限，到点中止 `context.signal`，这次尝试按失败处理 | 不限   |
| `retry`       | `(error) => boolean`，返回 `false` 就不再重试                     | 都重试 |
| `cache`       | 同一算子、同一输入的输出复用多少毫秒，`Infinity` 表示一直复用     | 不缓存 |

- 每次重试前发出 `retry` 事件。暂停、取消和 `LimitError` 不重试；已经往图里加过节点的规划节点也不重试，以免重复加节点。
- 超时靠 `signal` 协作：算子不理会 `signal` 也不会卡住运行，只是它后来的结果会被丢弃。
- 重试用完仍失败时，如果算子实现了 `recover(error, input, context)`，就用它的返回值作为节点输出，同样按 `outputSchema` 校验。只给某个输出端口值，就能把下游引到另一条分支。没有 `recover` 时，有下游就把 `{ error }` 传下去，没有下游就让运行失败。
- 进程意外退出后，同样用 `{ resume: {} }` 接着跑。运行期间每 10 秒刷新一次 `updated`，超过 30 秒没刷新才允许接手，避免同一次运行被两处同时执行。没跑完的节点从头重跑；规划节点没跑完时，它加过的节点作废，重跑时重新加。所以有副作用的算子要能安全地重复执行。
- 开了 `cache` 的节点先按“算子名 + 输入的 SHA-256”查 `Store` 的 `cache` 集合，没过期就直接用，`finish` 事件带 `cached: true`，不发 token 流也不计用量。缓存跨运行、跨会话共享，同一个 `Store` 里同名算子共用。规划节点、`recover` 兜底出的输出、用过人工回答的节点都不缓存；改了算子实现时换个名字，或者把 `cache` 设短一些。

## 执行规则

| 规则     | 说明                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| 端口推断 | 源端口取唯一的输出或 `result`，目标端口取唯一的输入或与源端口同名的输入                                    |
| 输入来源 | 优先级从低到高：运行输入里同名的字段、`node` 的 `input`、入边                                              |
| 数组端口 | schema 为 `array` 的输入端口可接多条边，按源节点创建顺序汇成数组；只接一条边且源端口本身是数组时整体传入   |
| 单值端口 | 只能接一条边；上游没在这个端口给值，节点就跳过，跳过沿下游传播                                             |
| 失败     | 先按 `policy` 重试，再交给 `recover`；仍然失败就向每条出边传 `{ error }`，下游照常收到；没有出边时运行失败 |
| 校验     | 执行前按 `inputSchema`、每次尝试后按 `outputSchema` 校验，输出不合格算这次尝试失败                         |

## 算子

```ts
interface Operator {
  name: string;
  description: string;
  inputSchema: JsonSchema; // 每个顶层属性是一个输入端口
  outputSchema: JsonSchema; // 每个顶层属性是一个输出端口
  plans?: boolean; // 能否往图里加节点
  uses?: readonly Operator[]; // 会用到的其他算子，自动登记
  policy?: Policy; // 重试、超时与缓存，见“容错与缓存”
  run(input: Values, context: Context): Promise<Values>;
  recover?(error: unknown, input: Values, context: Context): Promise<Values>; // 重试用完后的兜底
}
```

`context` 提供 `scope`（`run` / `session` / `user`）、`signal`、`remaining`（距离节点上限还能加几个节点）、`emit`、`publish`、`interrupt`、`spend`、`grow`。`tool(fn, { name, description, schema, policy })` 把函数包成节点，结果在 `result` 端口；`nest(runner)` 把一个 `Runner` 包成以 `task` 为输入的节点，`Workflow.node` 直接接受 `Runner`。

规划节点通过 `context.grow(plan)` 加节点，整批校验通过才加入，否则抛 `PlanError`、图不变。边只能进入这一批新加的节点，源节点必须已存在或在这一批里排得更前，所以创建顺序就是拓扑序，图不会成环。超出节点或 token 上限抛 `LimitError`。

## 存储

`Store` 只有三个方法：`get(collection, key)`、`put(collection, key, value)`、`list(collection, prefix)`（按键排序）。运行时用三个集合：

| 集合    | 键                      | 内容                                                                 |
| ------- | ----------------------- | -------------------------------------------------------------------- |
| `runs`  | `会话/创建时间/运行 id` | `Run` 记录，开始和结束时写入，运行期间每 10 秒刷新一次               |
| `steps` | `运行 id/序号`          | 只追加的日志：加进图的计划、节点结束或暂停时的状态、恢复时收到的回答 |
| `cache` | `算子名/输入的 SHA-256` | 节点输出和写入时间，见“容错与缓存”                                   |

日志只追加、每条只写一次，同一个节点以最后一条为准；恢复时从模板开始按日志重放。`MemoryStore` 存在内存里，`SqliteStore` 在 `@openagent/agent/node`。

## 分层

| 模块       | 内容                                          | 可以依赖                     |
| ---------- | --------------------------------------------- | ---------------------------- |
| `graph/`   | 算子、上下文、计划、JSON Schema、错误、`tool` | —                            |
| `engine/`  | 执行器 `Execution`、模板                      | `graph`                      |
| `storage/` | `Store`、`MemoryStore`                        | —                            |
| `runtime/` | `Runner`、`Workflow`、运行与事件的类型        | `graph`、`engine`、`storage` |

跨层一律经各层的 `index.ts` 引入，由 `tests/layering.test.ts` 机检。

## 开发

```bash
pnpm --filter @openagent/core test       # vitest
pnpm --filter @openagent/core typecheck  # tsc
```

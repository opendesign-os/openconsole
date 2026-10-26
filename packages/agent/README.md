# @openconsole/agent

基于 `@openconsole/graph` 的 harness agent 框架，对外 API 对齐 LangGraph。一次运行是一张**只追加的 DAG**：模型每次回复是一个节点，每次工具调用是一个节点，规划节点能往图里继续加节点。模型侧走 OpenAI 兼容的 Chat Completions 协议；内环借鉴 LLMCompiler，外环借鉴 GPTSwarm、AFlow、ADAS。

## 快速开始

```ts
import { createAgent, MemorySaver, tool, type ChatModel } from "@openconsole/agent";

const model: ChatModel = {
  model: "deepseek-chat",
  apiKey: process.env.DEEPSEEK_API_KEY ?? "",
  baseURL: "https://api.deepseek.com/v1",
};

const weather = tool(async ({ city }) => `${String(city)}：晴，25°C`, {
  name: "weather",
  description: "查询城市天气",
  schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
});

const agent = createAgent({
  model,
  tools: [weather],
  systemPrompt: "你是出行助手。",
  checkpointer: new MemorySaver(),
});

const config = { configurable: { thread_id: "demo" } };
const result = await agent.invoke({ messages: [{ role: "user", content: "北京今天适合跑步吗？" }] }, config);
console.log(result.answer);

for await (const chunk of await agent.stream({ messages: [{ role: "user", content: "那上海呢？" }] }, { ...config, streamMode: "updates" })) {
  console.log(chunk);
}
```

同一个 `thread_id` 上再次调用时，上一轮的 `messages` 会接在新输入前面，第二个问题因此带着第一轮的上下文。

## 与 LangGraph 的对应

| LangGraph                                                                           | 这里                                      | 说明                                                                                                   |
| ----------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `new StateGraph(State)`                                                             | `new FlowGraph()`                         | 节点之间沿端口传值，没有共享 state 和 reducer                                                          |
| `addNode(name, fn, options)`                                                        | `addNode(name, kind, { input, parent })`  | 节点是带输入输出 schema 的 `Kind`，`input` 是节点的常量输入                                            |
| `addEdge(a, b)`                                                                     | `addEdge("a.port", "b.port")`             | 端口能推断时只写节点名                                                                                 |
| `addConditionalEdges` / `Send`                                                      | 端口路由 / `context.grow`                 | 节点从哪个输出端口出值就走哪条边；动态扇出由规划节点追加节点                                           |
| `START` / `END`                                                                     | 无                                        | 没有入边的节点就是入口，结果取 `answer` 端口                                                           |
| `compile({ checkpointer, interruptBefore, interruptAfter, name })`                  | 同名                                      | 中断列表可以写节点 id，也可以写节点类型名                                                              |
| `invoke` / `stream` / `getState` / `getStateHistory` / `updateState` / `getGraph`   | 同名                                      | `streamMode` 支持 `values` / `updates` / `messages` / `custom` / `debug`，传数组时产出 `[mode, chunk]` |
| `configurable.thread_id` / `checkpoint_id`                                          | 同名                                      | 带 `checkpoint_id` 就从那个检查点继续                                                                  |
| `recursionLimit` / `maxConcurrency` / `signal`                                      | 同名，另有 `tokenLimit`                   | `recursionLimit` 数的是节点数，默认 100                                                                |
| `MemorySaver` / `BaseCheckpointSaver`                                               | `MemorySaver` / `Checkpointer`            | 每个节点结束存一个检查点                                                                               |
| `interrupt(value)` / `Command({ resume })` / `__interrupt__`                        | `context.interrupt(value)` / 同名 / 同名  | 多个节点同时等待时，`resume` 传以节点 id 为键的对象                                                    |
| `createReactAgent` / langchain `createAgent`                                        | `createAgent`，另有 `createCompilerAgent` | 输入输出是 `{ messages }`，另带 `answer`                                                               |
| langchain `tool` / `ChatOpenAI` / `asTool`                                          | `tool` / `ChatModel` / `asTool`           | `schema` 用 JSON Schema；`ChatModel` 接任何 OpenAI 兼容接口                                            |
| `GraphRecursionError` / `GraphInterrupt` / `InvalidUpdateError` / `GraphValueError` | 同名                                      | 另有 `ValidationError`、`APIError`、`TokenLimitError`                                                  |

## 自定义流程

```ts
const graph = new FlowGraph().addNode("search", search).addNode("summarize", summarize).addEdge("search", "summarize").compile({ checkpointer: new MemorySaver() });

const values = await graph.invoke({ query: "graph agents" }, config);
```

| 规则     | 说明                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------- |
| 端口推断 | 源端口取唯一的输出或 `result`，目标端口取唯一的输入或与源端口同名的输入                                  |
| 输入来源 | 优先级从低到高：运行输入里同名的字段、`addNode` 的 `input`、入边                                         |
| 数组端口 | schema 为 `array` 的输入端口可接多条边，按源节点创建顺序汇成数组；只接一条边且源端口本身是数组时整体传入 |
| 单值端口 | 只能接一条边；上游没在这个端口给值，节点就跳过，跳过沿下游传播                                           |
| 失败     | 失败节点向每条出边传 `{ error }`，下游照常收到，规划节点据此把工具报错交给模型                           |
| 校验     | 执行前按 `inputSchema`、执行后按 `outputSchema` 校验                                                     |
| 返回值   | 最近一个完成的、输出里声明了 `answer` 端口的节点的输出；有节点等待恢复时另带 `__interrupt__`             |

`getState` 的 `tasks` 列出每个节点的状态、输入、输出和错误。`updateState(config, values, asNode)` 改掉某个节点的输出并把它的下游重置为待运行，之后 `invoke(null, config)` 只重跑这些下游。

## 人工介入

```ts
const approve: Kind = {
  name: "approve",
  description: "等人确认",
  inputSchema: { type: "object", properties: { draft: { type: "string" } } },
  outputSchema: { type: "object", properties: { answer: {} } },
  run: async ({ draft }, context) => ({ answer: context.interrupt({ draft }) }),
};

const paused = await graph.invoke({ draft: "..." }, config); // paused.__interrupt__
const done = await graph.invoke(new Command({ resume: "通过" }), config);
```

- 第一次调用 `context.interrupt(value)` 时节点暂停；恢复时节点从头重跑，这一次 `interrupt` 直接返回 `resume` 的值，所以它之前的代码要能安全重复执行。
- 一个节点暂停时，与它无关的分支照常跑完，只有它的下游在等。
- `interruptBefore` 在节点运行前暂停，`interruptAfter` 在节点完成后停止调度，都用 `invoke(null, config)` 继续。

## 节点

```ts
interface Kind {
  name: string;
  description: string;
  inputSchema: JsonSchema; // 每个顶层属性是一个输入端口
  outputSchema: JsonSchema; // 每个顶层属性是一个输出端口
  plans?: boolean; // 能否往图里加节点
  uses?: readonly Kind[]; // 会用到的其他类型，FlowGraph 自动登记
  run(input: Values, context: Context): Promise<Values>;
}
```

`context` 提供 `signal`、`remaining`（距离 `recursionLimit` 还能加几个节点）、`emit`（模型 token，对应 `messages` 流）、`writer`（自定义数据，对应 `custom` 流）、`interrupt`、`spend`（记录 token 用量）、`grow`（规划节点追加节点）。

| 函数                                                  | 用途                                                                                                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `tool(fn, { name, description, schema })`             | 本地函数，结果在 `result` 端口                                                                                                                 |
| `prompt(spec, model)`                                 | 声明式的模型调用：`systemPrompt` 加输入输出 schema，按 schema 返回结构化结果，不合法时重试一次                                                 |
| `loop({ systemPrompt, tools }, model)`                | 规划节点：原生工具调用，每轮回复一个节点（`createAgent` 用它）                                                                                 |
| `compiler({ systemPrompt, tools, maxRounds }, model)` | 规划节点：一次回复产出整段带依赖的任务图，用 `"$1"` 引用前面任务的输出，边生成边入图，汇总节点决定回答还是重规划（`createCompilerAgent` 用它） |

规划节点通过 `context.grow(plan)` 加节点，整批校验通过才加入，否则抛 `InvalidUpdateError`、图不变。边只能进入这一批新加的节点，源节点必须已存在或在这一批里排得更前，所以创建顺序就是拓扑序，图不会成环。超出 `recursionLimit` 抛 `GraphRecursionError`，超出 `tokenLimit` 抛 `TokenLimitError`。

## 模型

`complete(model, request, hooks)` 直接用 `fetch` 调 `/chat/completions`，不依赖 `openai` SDK，浏览器和 Node 都能跑；SSE 由 `eventsource-parser` 解析，408 / 409 / 429 / 5xx 按指数退避重试。各家「OpenAI 兼容」并不一致，差异由 `ChatModel.profile` 声明：

| 字段         | 取值                                   | 默认         | 影响                                                          |
| ------------ | -------------------------------------- | ------------ | ------------------------------------------------------------- |
| `tools`      | 是否支持工具调用                       | `true`       | 不支持时带工具的请求直接报错                                  |
| `structured` | `schema` / `json` / `none`             | `schema`     | 对应 `response_format` 的 `json_schema`、`json_object` 或不发 |
| `reasoning`  | `send` / `drop`                        | `drop`       | 历史里的 `reasoning_content` 是否回传                         |
| `limit`      | `max_tokens` / `max_completion_tokens` | `max_tokens` | 输出上限的参数名                                              |
| `usage`      | 流里是否带用量                         | `true`       | 是否发 `stream_options.include_usage`                         |

## 外环优化

外环的输入是一个 `FlowGraph` 模板加一组能自动打分的任务：

```ts
const report = await evaluate(flow, {
  cases: [{ input: { question: "6 x 7?" }, expect: "42" }],
  score: (answer, sample) => (answer === sample.expect ? 1 : 0),
  repeats: 5,
});
```

| 论文              | 函数                                                        | 做法                                                                                                               |
| ----------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| GPTSwarm 节点优化 | `demonstrate(spec, report)` / `refine(spec, report, model)` | 从高分运行里挑示范；或让模型根据执行历史改写 `systemPrompt`                                                        |
| GPTSwarm 边优化   | `candidates` / `sample` / `reinforce` / `tune`              | `addEdge(a, b, { probability })` 标出候选边，按概率采样，成环的边由 `Ordering` 检出后跳过，按得分用 REINFORCE 更新 |
| AFlow             | `search(flow, bench, propose)` / `proposer(model)`          | 变体树：按软混合概率挑变体、提出一处修改、评测打分，修改用 `diff` 记成补丁并作为经验交给下一次提议                 |
| ADAS              | `explore(seeds, bench, { meta, worker })`                   | 元模型参考存档设计新的 `Prompt`，两轮自查后评测入档，不执行模型写的代码                                            |

## 分层

| 目录        | 内容                                                         | 可以依赖                                      |
| ----------- | ------------------------------------------------------------ | --------------------------------------------- |
| `common/`   | 节点类型、计划、JSON Schema、错误                            | —                                             |
| `model/`    | OpenAI 兼容客户端：protocol、profile、client                 | `common`                                      |
| `runtime/`  | 执行器、模板、存档：session、template、trace                 | `common`                                      |
| `node/`     | 不改图的节点：tool、prompt                                   | `common`、`model`                             |
| `planner/`  | 往图里加节点的节点：loop、compiler                           | `common`、`model`                             |
| `graph/`    | 对外的图 API：builder、compiled、checkpoint、command、config | `common`、`runtime`                           |
| `prebuilt/` | createAgent、createCompilerAgent                             | `common`、`model`、`planner`、`graph`         |
| `optimize/` | evaluate、demonstrate、edge、search、archive                 | `common`、`model`、`runtime`、`node`、`graph` |

跨层一律经各层的 `index.ts` 引入。这张表由 `tests/layering.test.ts` 机检，`core/` 下新增目录必须先登记层级；测试目录按同样的层次组织。

## 尚未包含

- OpenTelemetry 导出（`stream` 的 `debug` 模式已有完整事件）
- MCP 工具适配
- 代码节点与沙箱
- 持久化存储后端（实现 `Checkpointer` 的 `get` / `put` / `list` 即可）

## 开发

```bash
pnpm --filter @openconsole/agent test       # vitest
pnpm --filter @openconsole/agent typecheck  # tsc
```

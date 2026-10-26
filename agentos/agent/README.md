# @openagent/agent

构建在 [`@openagent/core`](../core) 之上的 agent 框架。对外只有几个对象：`Agent`、`Workflow`、工具包和插件；会话、记忆、压缩、审批这些能力全部由插件和工具提供，`Agent` 本身只收 9 个参数。每次模型回复、每次工具调用（包括作为工具的子 agent）都是运行图里的一个节点；上下文压缩把较早的对话收成一张记忆图谱。

## 快速开始

```ts
import { Agent, compress, history, workspace } from "@openagent/agent";
import { DiskBackend, SqliteStore } from "@openagent/agent/node";

const workbench = new Agent({
  name: "workbench",
  model: "openai:gpt-5.5",
  store: new SqliteStore("workbench.db"),
  tools: [workspace(new DiskBackend("."))],
  plugins: [history(3), compress()],
});

const run = await workbench.run("整理一下 README", { session: "s1" });
if (run.status === "paused") {
  // 写文件前要确认：run.pending[0].value 是 { tool, input }
  await workbench.run({ resume: { [run.pending[0].id]: { type: "approve" } } }, { session: "s1" });
}

for await (const event of workbench.stream("继续", { session: "s1" })) {
  if (event.type === "delta") process.stdout.write(event.text);
}
```

| 参数           | 说明                                                                     |
| -------------- | ------------------------------------------------------------------------ |
| `name`         | 名字，也是运行图里规划节点的 id                                          |
| `description`  | 作为别的 agent 的工具时给模型看的说明                                    |
| `model`        | `"provider:model"` 字符串或 `Model` 对象                                 |
| `instructions` | 系统提示                                                                 |
| `tools`        | 工具、工具包，或者别的 `Agent` / `Workflow`                              |
| `plugins`      | 插件，见下文                                                             |
| `planner`      | 规划器，默认 `loop()`，可换成 `compiler()` 或自己写                      |
| `store`        | 运行、记忆和长结果的存储，默认 `MemoryStore`                             |
| `limits`       | `{ nodes, tokens, concurrency }`，节点上限默认 1000                      |
| `policy`       | 所有节点默认的重试、超时与缓存，工具自己的 `policy` 优先；规划节点不缓存 |

`run` / `stream` / `runs`、事件，以及重试、超时、缓存、`recover` 和崩溃后续跑的规则见 [`@openagent/core`](../core)。

## 示例

[`examples/chat.ts`](examples/chat.ts) 是一个命令行对话 agent：

- 会话存在 `chat.db`（`SqliteStore`），重启后接着聊。上次的运行没跑完（进程中途退出、失败或在等审批）时，启动会先问要不要接着跑。
- 可以读写 `workspace/` 目录，写之前在终端问 y/n。
- 带 `history(3)` 和 `compress()`。
- 节点最多试 3 次，单次 2 分钟超时。模型接口的错误客户端已经重试过，所以节点不再重试它们。终端里会显示每次重试，命中缓存的工具结果后面标“（缓存）”。

模型配置从 `.env` 读取（已被 git 忽略）：

```ini
OPENAI_BASE_URL=https://api.deepseek.com/v1
OPENAI_API_KEY=sk-...
OPENAI_MODEL=deepseek-chat
```

```bash
pnpm --filter @openagent/agent example
```

## 和 agno 的对照

agno 把每种能力做成 `Agent` 的一个开关，参数超过一百个；这里把能力做成插件和工具，参数不随能力增加：

| agno                                                                        | 这里                                                                  |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `Agent(model="openai:gpt-5.5", db=SqliteDb(...))`                           | `new Agent({ model: "openai:gpt-5.5", store: new SqliteStore(...) })` |
| `tools=[Workspace(".")]`，`confirm` 列表                                    | `tools: [workspace(backend, { confirm })]`                            |
| `add_history_to_context=True, num_history_runs=3`                           | `plugins: [history(3)]`                                               |
| `compress_tool_results`、`offload_tool_results`、`enable_session_summaries` | `plugins: [compress()]`，见「记忆图谱」                               |
| `tool_hooks`、`pre_hooks`、`post_hooks`                                     | 插件的 `permission` / `result` / `start` / `end`                      |
| `Team(members=[...])`                                                       | 把 agent 直接放进 `tools`                                             |
| `Workflow(steps=[...])`                                                     | `Workflow` 是一张图，节点可以是 agent                                 |
| `requires_confirmation`、`continue_run`                                     | `confirm(tool)`，`run({ resume })`                                    |
| `AgentOS`                                                                   | 尚未包含                                                              |

## 记忆图谱

`compress()` 让上下文保持在预算内：最近的对话原样保留，较早的内容收进一张记忆图谱，每次调用模型前只取和当前问题相关的子图。设计取自几篇论文：

| 论文           | 取了什么                                                                                 | 落在这里                                                                      |
| -------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Zep / Graphiti | 片段、实体、社区三层；事实带有效期，被推翻的事实标记失效而不删除；上下文由事实和实体拼成 | 每次运行是一个片段；实体是节点，事实是边，带 `since` / `until` 和来源片段     |
| Mem0 / Mem0g   | 每轮对话后抽取；更新时把相关的已有记忆一起给模型，由它决定新增、更新还是作废             | `distill` 把已有的相关事实写进提示，模型返回新增的实体、事实和作废的事实      |
| HippoRAG       | 用问题里的实体做种子，跑重启概率 0.5 的个性化 PageRank，种子按特异性加权                 | `recall` 用问题里出现的实体做种子，按 PageRank 给事实排序，在预算内拼成上下文 |
| G-Memory       | 把完成的协作轨迹提炼成更小的图                                                           | 运行图本身就是交互图，提炼进记忆图谱的只有实体和事实                          |

具体做法：

1. 每次运行结束，把这次运行的对话提炼进图谱（同名实体合并，事实去重，被推翻的事实写上 `until`）。
2. 上下文超过 `budget`（估算的 token 数，默认 60000）时，把较早的一半消息（不拆开工具调用和它的结果）提炼进图谱后移出上下文。
3. 每次调用模型前，取和最后一条用户消息相关的事实和实体，以 `<facts>` / `<entities>` 的形式放进系统提示。
4. 超过 `limit` 个字符（默认 20000）的工具结果存进 `store`，模型只看到开头，可用 `expand` 工具分页读完。

图谱按 `user`（没有时按 `session`）存进 `store`，所以给了 `user` 的记忆可以跨会话复用。图谱的大小随事实数增长，不随对话轮数增长。`Memory`、`distill` 也可以单独使用。

## 插件

插件就是 [`@openconsole/plugable`](../../packages/plugable) 的插件：`{ name, enforce?, before?, after?, setup(api) }`，在 `setup` 里往 hooks 上注册回调。回调签名是 `(input, output)`，改 `output` 或返回新值都可以：

| hook         | 时机           | 输入                       | 可改的输出                                                    |
| ------------ | -------------- | -------------------------- | ------------------------------------------------------------- |
| `tools`      | 第一次运行前   | `{ agent }`                | 工具列表，可以增、删或包装                                    |
| `context`    | 每次调用模型前 | `{ context }`              | `{ system, history, messages }`，只有 `messages` 写回运行记录 |
| `permission` | 每次调用工具前 | `{ tool, input, context }` | `{ status, input, reason }`                                   |
| `result`     | 每次工具返回后 | `{ tool, input, context }` | `{ result }`                                                  |
| `start`      | 每次运行开始   | `Run`                      | —                                                             |
| `end`        | 每次运行结束   | `Run`                      | —                                                             |

```ts
import type { AgentHooks, AgentHost } from "@openagent/agent";

import { definePlugin } from "@openconsole/plugable";

const audit = definePlugin<AgentHooks, AgentHost>({
  name: "audit",
  setup(api) {
    api.hooks.result.tap({}, ({ tool, input }, output) => {
      console.log(tool.name, input, output.result);
    });
  },
});
```

- `api.host` 带着 `agent`、`model`、`store` 和 `runs(session)`；插件之间用 `provide` / `consume` 共享值。
- 同名插件只装第一个，所以把自己的同名插件放在前面就能替换内置的。
- `permission` / `result` 的回调在工具节点里运行，可以调用 `context.interrupt`。
- 插件在第一次运行时装配；用完调用 `await agent.dispose()`。

## 工具

| 写法                                      | 说明                                                                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `tool(fn, { name, description, schema })` | 普通函数，来自 `@openagent/core`                                                                                              |
| 工具包 `{ name, instructions, tools }`    | 说明合并进系统提示                                                                                                            |
| `workspace(backend, { confirm })`         | `ls`、`read`、`write`、`edit`、`glob`、`grep`；`confirm` 默认是 `["write", "edit"]`                                           |
| `confirm(tool)`                           | 运行前暂停，恢复值是 `{ type: "approve" }`、`{ type: "edit", input }` 或 `{ type: "reject", reason }`                         |
| `Agent` / `Workflow`                      | 作为以 `task` 为输入的工具，在独立会话里运行，token 流转发给外层；它暂停时外层也暂停，`pending` 的 id 形如 `agent/1:writer/1` |

工作区后端实现 `Backend` 的 `list` / `read` / `write`：`MemoryBackend` 存在内存里，`DiskBackend` 落在给定目录下。路径一律是以 `/` 开头的绝对路径，不能跳出工作区。

## 模型

`"provider:model"` 里的 provider 决定接口地址和读取 key 的环境变量：

| provider     | 地址                                                | key                  |
| ------------ | --------------------------------------------------- | -------------------- |
| `openai`     | `https://api.openai.com/v1`                         | `OPENAI_API_KEY`     |
| `deepseek`   | `https://api.deepseek.com/v1`                       | `DEEPSEEK_API_KEY`   |
| `qwen`       | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `DASHSCOPE_API_KEY`  |
| `moonshot`   | `https://api.moonshot.cn/v1`                        | `MOONSHOT_API_KEY`   |
| `openrouter` | `https://openrouter.ai/api/v1`                      | `OPENROUTER_API_KEY` |
| `ollama`     | `http://localhost:11434/v1`                         | —                    |

`register(name, { baseURL, key, profile })` 加新的 provider；也可以直接传 `Model` 对象（`model`、`apiKey`、`baseURL`、`temperature`、`maxTokens`、`timeout`、`retries`、`headers`、`fetch`、`profile`）。客户端直接用 `fetch` 调 `/chat/completions`，408 / 409 / 429 / 5xx 按指数退避重试，失败抛 `APIError`。各家「OpenAI 兼容」的差异由 `profile` 声明：

| 字段         | 取值                                   | 默认         | 影响                                                          |
| ------------ | -------------------------------------- | ------------ | ------------------------------------------------------------- |
| `tools`      | 是否支持工具调用                       | `true`       | 不支持时带工具的请求直接报错                                  |
| `structured` | `schema` / `json` / `none`             | `schema`     | 对应 `response_format` 的 `json_schema`、`json_object` 或不发 |
| `reasoning`  | `send` / `drop`                        | `drop`       | 历史里的 `reasoning_content` 是否回传                         |
| `limit`      | `max_tokens` / `max_completion_tokens` | `max_tokens` | 输出上限的参数名                                              |
| `usage`      | 流里是否带用量                         | `true`       | 是否发 `stream_options.include_usage`                         |

`prompt(spec, model)` 是声明式的模型节点：`systemPrompt` 加输入输出 schema，按 schema 返回结构化结果，不合法时重试一次。`@openagent/agent/testing` 提供按脚本回复的假模型，便于测试。

## 规划器

| 规划器                 | 做法                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `loop()`               | 原生工具调用，每轮回复一个节点，同一轮的多个调用并行                                                            |
| `compiler({ rounds })` | LLMCompiler：一次回复产出带依赖的任务图，用 `"$1"` 引用前面任务的输出，边生成边执行，汇总节点决定回答还是重规划 |

规划器是 `(setup) => Operator`，`setup` 带着 `name`、`model`、`instructions`、`tools` 和 `prepare`（每次调用模型前经过插件的 `context` hook），自己写一个也只需要实现这个函数。

## 外环优化

| 论文              | 函数                                                        | 做法                                                                                                            |
| ----------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| GPTSwarm 节点优化 | `demonstrate(spec, report)` / `refine(spec, report, model)` | 从高分运行里挑示范；或让模型根据执行历史改写 `systemPrompt`                                                     |
| GPTSwarm 边优化   | `candidates` / `sample` / `reinforce` / `tune`              | `edge(a, b, { probability })` 标出候选边，按概率采样，成环的边由 `Ordering` 检出后跳过，按得分用 REINFORCE 更新 |
| AFlow             | `search(flow, bench, propose)` / `proposer(model)`          | 变体树：按软混合概率挑变体、提出一处修改、评测打分，修改用 `diff` 记成补丁并作为经验交给下一次提议              |
| ADAS              | `explore(seeds, bench, { meta, worker })`                   | 元模型参考存档设计新的 `Prompt`，两轮自查后评测入档，不执行模型写的代码                                         |

`evaluate(flow, bench)` 是它们共用的评测：一个 `Workflow` 加一组能自动打分的任务。优化出来的 `Workflow` 可以直接放进 agent 的 `tools`。

## 分层

| 模块         | 内容                                                            | 可以依赖                             |
| ------------ | --------------------------------------------------------------- | ------------------------------------ |
| `model/`     | `Model`、客户端、provider、`prompt` 算子、测试用的假模型        | —                                    |
| `memory/`    | 记忆图谱 `Memory`、提炼 `distill`                               | `model`                              |
| `tool/`      | 工具包、工作区、`confirm`                                       | —                                    |
| `planner/`   | `loop`、`compiler`、`Conversation`                              | `model`                              |
| `plugin/`    | hooks、`guard`、`history`、`compress`                           | `model`、`memory`、`planner`         |
| `agent.ts`   | `Agent`                                                         | `model`、`planner`、`plugin`、`tool` |
| `optimizer/` | evaluate、demonstrate、edge、search、explore                    | `model`                              |
| `node/`      | `DiskBackend`、`SqliteStore`，只从 `@openagent/agent/node` 导出 | `tool`                               |

跨层一律经各层的 `index.ts` 引入，由 `tests/layering.test.ts` 机检。

## 尚未包含

- 服务层（类似 AgentOS）：HTTP / SSE 接口、会话隔离、定时任务、OpenTelemetry 追踪、MCP 服务
- 子 agent 内部的暂停与恢复
- 记忆图谱的社区层与经验层（Zep 的社区摘要、G-Memory 的 insight），以及用向量匹配实体

## 开发

```bash
pnpm --filter @openagent/agent test       # vitest
pnpm --filter @openagent/agent typecheck  # tsc
pnpm --filter @openagent/agent example    # 运行示例
```

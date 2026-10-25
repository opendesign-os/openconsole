# AI 组件设计与统一检索：bit.dev 原理分析与系统方案

## 一、bit.dev 的实现原理

bit 对外的叙事是"组件市场"，但它真正的工程内核是一套**让组件成为可独立寻址、可独立验证、可独立演进的一等对象**的机制。拆开看是六层。

### 1. 组件模型：边界由入口定义，依赖由静态分析推导

bit 不用 `package.json` 划分组件边界。一个组件 = **一组文件 + 一个 mainFile 入口**，边界由 `.bitmap` 里的文件映射确定。依赖不靠人工声明，而是扫描源码 import 后推导，分成三类：npm 包、其他组件、组件内文件。

推导结果会被**扁平化**后写进版本对象 —— `scopes/scope/objects/models/version.ts` 里的 `flattenedDependencies`（全量依赖闭包的 ComponentID 列表）和 `flattenedEdges`（`{source, target, type: prod|dev|peer|ext}` 的边集）。闭包和边集都大到需要单独存成 `Ref` 再按需加载，源码里专门为此做了 ID 驻留缓存。

这件事的意义：**组件的依赖是被计算出来的事实，不是被声明的意图**。人工维护的依赖声明一定会漂移，计算出来的不会。AI 生成代码时更是如此 —— 它不会可靠地去改 `package.json`。

### 2. 存储：git 风格的内容寻址对象库，但每个组件有独立的提交 DAG

`scopes/scope/objects/` 下是一套完整的 git 内核复刻：

| bit 对象 | git 对应 | 内容 |
|---|---|---|
| `Source` | blob | 文件内容 |
| `Version` | commit | 快照：`files[]`(→Ref)、依赖、`log`、`docs`、`extensions`、`buildStatus`、`parents[]` |
| `ModelComponent` | refs 表 | 该组件的 `versions{tag→Ref}`、`head`、`detachedHeads` |
| `Lane` | branch | 跨组件的变更集 |
| `VersionHistory` | — | 提交 DAG 的物化缓存 |
| `Symlink` | — | 重命名/迁移后的转发 |

`BitObject` 基类做的事和 git 一模一样：序列化 → `type hash length\0content` 头 → zlib 压缩 → sha1 作为地址（`object.ts`）。`Ref` 就是一个 hash 指针（`ref.ts`）。另有 `ScopeIndex`（`index.json`）维护 `componentId → hash` 的平表索引，避免每次检索都遍历对象库。

**与 git 最本质的区别：git 是整个仓库一条提交 DAG，bit 是每个组件一条独立 DAG。** 这是 bit 所有能力的根 —— 一个组件可以单独打版本、单独导出、单独被下游按版本消费，而不被仓库里其他组件的变更牵连。Lane 则是在这之上叠加的"跨组件变更集"，用来做一次涉及多个组件的协同改动。

代价同样清楚：这是一套**自有版本控制系统**，和 git 并行存在，团队要同时理解两套心智模型。

### 3. 寻址：ComponentID 把组件地址和包名统一

`ComponentID = <org>.<scope>/<namespace>/<name>@<version>`。version 可以是 semver tag，也可以是 snap（hash）。这个 ID 按 `bindingPrefix` 规则自动映射成 npm 包名，于是**同一个东西既是"组件"也是"包"**：在 bit 工作区里按组件消费（可源码进入、可改），在外部项目里按 npm 包消费（只读）。

### 4. 隔离：Capsule 让"能否独立运行"成为可自动验证的事实

`scopes/component/isolator/` 实现了文件系统级隔离：每个组件被物化到一个独立目录（capsule），只包含自己的文件 + 指向依赖 capsule 的符号链接；一组互相依赖的 capsule 构成 `Network = { graph, capsules }`。

构建、测试、预览全部在 capsule 里跑，**不在原工作区跑**。这样任何隐式依赖（蹭了工作区根目录的包、全局状态、相对路径穿越）都会立刻失败。换句话说，"这个组件是不是真的独立"从一句口号变成一条 CI 断言。

### 5. 语义层：APISchema —— 整个体系里对 AI 最关键的一层

`@teambit/semantics.entities.semantic-schema` 把 TypeScript 的类型系统完整建模成可序列化的节点树：`class` / `interface` / `function-like` / `type-union` / `type-ref` / `parameter` / `get-accessor` / `index-signature` / `template-literal-type` ... 以及 JSDoc 的 `doc` / `tag` / `return-tag` / `property-like-tag`。

`APISchema` 持有 `module`（公开导出）、`internals`（内部）、`componentId`、`taggedModuleExports`，并提供 `toObject()` / `fromObject()`（可持久化、可传输）、`toFullSignature()`（可直接喂给模型的签名文本）、`listSignatures()`。

更关键的是 `SchemaNode.diff()` 返回 `SchemaChangeFact[]`，再由 `semantic-schema-diff` 的 `ImpactAssessor` + `DEFAULT_IMPACT_RULES` 评估影响等级。schema 抽取本身是构建流水线里的一个 task（`SchemaTask`），产物作为 artifact 存进 Version 对象。

所以 bit 能回答这类问题而不读源码：**这个组件怎么用？我这次改动会不会破坏下游？** 这是"AI 能可靠复用组件"与"AI 只能瞎猜"的分界线。

### 6. 扩展：Harmony Aspect

bit 自身由组件构成，插件系统叫 Harmony。一个 Aspect 是**全栈特性单元**，可以同时在 `main` / `ui` / `preview` 等多个 runtime 注册行为；Aspect 之间通过 `Slot` 注册槽和依赖注入互相扩展（见 `schema.main.runtime.ts` 里的 `ParserSlot`、`ImpactRuleSlot` —— 解析器和影响规则都是别的 aspect 注册进来的）。

组件最终生效的 aspect 配置来自多个来源的合并，优先级从具体到一般：`BitmapFile` → `ComponentJsonFile` → `WorkspaceVariants` → `Model`。Env（编译器/测试器/预览/生成器的组合）本身也是一个 aspect 组件。

### 7. AI 接入层

`scopes/mcp/cli-mcp-server/` 是官方 MCP server，工具集的设计取舍很值得抄：

- `bit_remote_search` —— **接收查询数组并行检索**再去重。描述里明确要求模型一次给多个同义词或多个所需组件（`["button","btn","click"]`）。同时自动从 `workspace.jsonc` 的 `defaultScope` 提取 owner 作为过滤条件，把检索默认收敛到本组织。
- `bit_component_details` —— 一次最多 5 个组件，防止 context 爆炸；返回 `.docs.mdx` 文档 + composition 文件里的用法示例 + 可选的 API schema（**默认 false**，按需才取）。
- `bit_create` —— 按模板批量创建组件，校验模板存在性与冲突。
- `bit_query` / `bit_execute` —— **只读白名单与写操作彻底分离**。白名单里是 `status/list/show/schema/graph/deps/why/log/diff/...`，写操作走单独的工具。
- `bit mcp-server rules` —— 生成给 AI agent 的规则文件，把"先检索后生成"固化成工作流而非建议。

---

## 二、哪些值得拿，哪些不要

真正产生价值的是四个机制，和"组件市场"关系不大：

1. **边界与依赖可计算** —— AI 产出的代码能被自动归档成边界清晰的组件
2. **契约可机读（APISchema）** —— AI 知道怎么用，不必读实现
3. **隔离可验证（Capsule）** —— AI 产出能否进库，由机器裁决
4. **变更可评估（schema diff + impact）** —— AI 改组件时知道会炸到谁

不建议复刻的：

- **自有版本控制对象库**。bit 做它是因为要支持"任意 git 仓库里的任意目录都能独立发版"。如果组件本来就住在一个 monorepo 里，git + pnpm workspace + changesets 已经覆盖，再叠一套 DAG 只会制造两套真相。
- **Env 全家桶**。bit 的 env 要接管 compiler/tester/linter/preview/generator。现有 tsconfig + vitest + prettier 工具链替换成本极高、收益极低。
- **自有 registry**。npm 已经是 registry，缺的只是**检索层**，不是分发层。

结论：**取机制，不取实现**。把那四个机制架在现有 pnpm workspace 之上。

---

## 三、系统设计：`catalog`

### 定位

一个**组件编目与检索内核**：从源码抽取组件的结构化事实，建立可被人和 AI 同时消费的索引，并为 AI 生成组件提供"检索优先 + 契约约束 + 隔离验证"的闭环。

它不管分发（npm 管）、不管版本（git 管）、不管构建（现有工具链管）。

### 分层

```
                  ┌───────────────────────────────┐
   AI / IDE  ───▶ │  mcp        AI 接入（工具面）   │
                  ├───────────────────────────────┤
   Web UI    ───▶ │  index      检索（词法/语义/图） │
                  ├───────────────────────────────┤
                  │  manifest   组件事实（统一记录） │
                  ├───────────────┬───────────────┤
                  │  schema       │  capsule      │
                  │  契约抽取      │  隔离验证      │
                  └───────────────┴───────────────┘
                            ▲
                     pnpm workspace / git
```

### 1. `manifest` —— 组件事实记录

组件身份直接复用包体系，不发明新 ID：

```
@openconsole/shadcn#ui/button
└─ 包名 ─────────┘ └─ 导出路径 ─┘
```

版本就是包版本。无需 scope 概念 —— pnpm workspace 已经是 scope。

每个组件对应一条 manifest，**全部字段从代码抽取，不手写**：

| 字段 | 来源 | 用途 |
|---|---|---|
| `id` | 包名 + 导出路径 | 寻址 |
| `kind` | 目录约定 / 导出形态 | `primitive` \| `composite` \| `layout` \| `provider` \| `hook` |
| `intent` | JSDoc 首段 + README | 语义检索的主要素材 |
| `api` | `schema` 层抽取 | 契约 |
| `deps` | import 静态分析 | 图检索 |
| `tokens` | className / CSS 变量扫描 | 设计一致性校验 |
| `examples` | `*.demo.tsx` 约定文件 | 喂给 AI 的用法样本 |
| `status` | `capsule` 验证结果 | 准入闸门 |

手写的字段一定会过期，这是铁律。唯一允许手写的是**覆盖层**（`component.json` 里少量人工标注，如 `deprecated`、`replacedBy`、业务分类），抽取结果与覆盖层合并，覆盖层优先。

### 2. `schema` —— 契约抽取

整个系统的地基。用 TypeScript Compiler API 抽取：

- props 类型（含联合字面量 —— `variant: "default" | "destructive" | ...` 这类对 AI 最有价值）
- 泛型参数与约束
- 事件回调签名
- `ref` 转发类型
- 默认值（从解构默认值和 `defaultProps` 取）
- JSDoc 描述与 `@example` / `@deprecated` 标签

输出要求两条：**可序列化**（JSON，可入索引、可传输、可缓存）、**稳定排序**（同一份源码必须产出同一份 JSON，才能 hash 比对与 diff）。

在此之上做 `diff`：对比两个版本的 schema，产出变更事实（新增导出 / 删除导出 / props 收窄 / 必填项新增 / 联合分支移除 ...），再按规则判定影响等级。**这条链路不做，AI 改组件就是盲改。**

实现上，抽取器与影响规则都做成 `@openconsole/plugable` 插件 —— 它的 `setup(api)` + hook 槽位形态正好对应 bit 的 Slot 机制，不同框架（React / Vue / 纯函数包）注册各自的抽取器。

### 3. `index` —— 三路检索

这是方案里最需要想清楚的部分。**只做向量检索的"AI 组件库"基本都失败**，因为 AI 的提问有三种，向量只覆盖其中一种：

| 提问 | 例子 | 检索方式 |
|---|---|---|
| 我需要一个能做 X 的东西 | "带分页的数据表格" | **语义** —— embedding |
| Y 的确切用法是什么 | "Button 的 variant 有哪些值" | **词法** —— BM25 / 精确匹配 |
| 改 Z 会影响什么 | "改 Input 的 props 会炸到谁" | **结构** —— 图查询 |

三路各自的设计要点：

**语义路**：embedding 的输入是 `intent + props 语义摘要 + 示例描述`，**不是源码**。对源码做 embedding 是常见错误 —— 实现细节会淹没意图，两个意图完全不同但都用了 `useState + map` 的组件会被判为相似。

**词法路**：对 `id / 名称 / kind / props 名 / 字面量枚举值 / tokens` 建倒排。AI 问到具体标识符时，精确匹配比向量可靠得多。

**结构路**：直接复用 `@openconsole/graph` —— 它已经有 DAG、拓扑排序、SCC、CSR 不可变表示。组件依赖图就是一个有向图，`graph` 的能力可以原样用来回答：
- 反向可达 → "改它影响谁"
- 正向闭包 → "引入它要带进什么"
- 共现聚类 → "通常和什么一起用"

三路结果做融合排序（RRF 或加权），并支持过滤（kind、status、包）。

**检索结果必须分级返回**：第一级只给 `id + intent + 签名摘要`，第二级才给完整 schema 与示例。这是从 bit 的 `includeSchema` 默认 `false` 和你们 `mcp` 包里 `discovery: progressive` 学到的同一件事 —— context 预算是稀缺资源。

### 4. `capsule` —— 隔离验证

AI 生成的组件进库前必须通过的闸门。隔离程度不必做到 bit 那样的文件系统 capsule（成本高），但必须隔离**依赖可见性**：在一个只安装了该组件声明依赖的临时环境里跑：

1. 类型检查通过
2. 示例能渲染，无运行时报错
3. a11y 基础检查（role / label / 键盘可达）
4. 视觉快照（有基线时做比对）
5. 设计 token 合规（不出现硬编码色值/间距）

未通过 → `status: draft`，可检索但明确标注未验证；通过 → `status: ready`。

**这一层是组件库不被 AI 污染的唯一保障。** 没有它，AI 生成得越快，库烂得越快。

### 5. `mcp` —— AI 接入

复用已有的 `@openconsole/mcp` 网关挂载，工具面照搬 bit 验证过的取舍：

| 工具 | 说明 |
|---|---|
| `search` | **接收查询数组**并行检索去重；支持 `kind` / `status` 过滤；返回一级摘要 |
| `details` | 一次最多 5 个 id；返回 intent + API schema + 示例；完整 schema 按需 |
| `impact` | 给定组件，返回反向依赖与受影响面 |
| `create` | 按模板生成组件骨架（模板本身也是组件） |
| `verify` | 跑 capsule 验证，返回结构化失败原因 |

读写分离：前三个只读，后两个写。

### 6. 生成闭环

AI 设计组件的难点从来不是"写出一个组件"，是"写出一个与现有体系一致的组件"。闭环必须是强制工作流，写进 rules 文件：

```
需求
 ├─▶ search          先检索。这一步不可跳过
 │     ├─ 命中 → 直接用
 │     └─ 近似命中 → details 看契约 → 组合 / 扩展 props
 └─▶ 确实没有
       ├─▶ create    从模板生成，模板带上设计 token 与 a11y 骨架
       ├─▶ schema    抽取契约，与同类组件比对命名一致性
       ├─▶ verify    capsule 验证
       └─▶ 入库      status: ready，索引增量更新
```

`search` 不可跳过这一条，要同时写进 MCP 工具描述和 rules 文件。bit 在 `bit_remote_search` 的 description 里反复强调检索策略，就是在用工具描述约束模型行为 —— 这比在系统提示里讲道理有效得多。

---

## 四、与现有 packages 的对应

现有仓库里，这套系统所需的底座大部分已经存在：

| 已有包 | 在 catalog 中的角色 |
|---|---|
| `graph` | 结构检索内核 —— 依赖图、反向可达、闭包、拓扑 |
| `plugable` | 抽取器 / 校验器 / 索引器的插件机制，对应 bit 的 Aspect Slot |
| `mcp` | AI 接入网关，`progressive` 发现模式正好对应分级返回 |
| `shadcn` / `atoms` | 首批被编目的组件源，也是检索质量的验证集 |
| `signal` | 索引增量更新的事件总线 |
| `interaction` / `matrix` | 可视化编排界面（拖拽组装组件树）的基础 |

需要新增的只有 `schema`（契约抽取）、`index`（检索）、`capsule`（验证）三块，以及把它们串起来的 `catalog` 门面。

---

## 五、落地顺序

每一步都要能单独交付价值，不能等全套做完才见效：

**第一步：`schema` 抽取 + CLI**
对 `shadcn` / `atoms` 跑通 props 契约抽取，产出 JSON。立刻可用：自动生成组件文档，替代手写的 props 表。

**第二步：`index` 的词法路 + 结构路**
基于 schema JSON 和 `graph` 建索引。立刻可用：命令行查"谁用了这个组件"、"这个 props 在哪些组件里出现过"，重构时直接受益。

**第三步：`mcp` 工具面**
挂 `search` / `details` / `impact` 三个只读工具。立刻可用：AI 写业务代码时能准确复用现有组件，不再重复造轮子 —— 这一步的收益通常最明显。

**第四步：语义路 + 生成闭环**
加 embedding 检索，加 `create` / `verify`。这一步才真正进入"AI 设计组件"。

**第五步：可视化**
基于 `interaction` / `matrix` 做组件编排界面，检索结果可直接拖进画布组装。

先做前三步。它们不依赖 AI 效果，收益确定；第四步的质量完全取决于前三步积累的事实质量 —— **索引质量决定 AI 上限，这是整个方案的核心假设**。

---

## 参考

- [Aspects overview — bit](https://bit.dev/reference/extending-bit/aspect-overview/)
- [Component ID — bit](https://bit.dev/reference/components/component-id/)
- [teambit/bit 源码](https://github.com/teambit/bit)
- [Bit Cloud builds more visibility and control into AI-generated applications — SiliconANGLE](https://siliconangle.com/2025/05/28/bit-cloud-builds-control-ai-generated-applications/)
- [Hope AI by Bit Cloud](https://www.producthunt.com/products/hope-ai-by-bit-cloud)

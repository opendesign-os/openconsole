# @openconsole/shadcn

> 整套 [shadcn/ui](https://ui.shadcn.com) 原语 + 设计 token，按包发布，配套 Tailwind v4 主题与 OKLCH 配色。

`@openconsole/shadcn` 把 shadcn 官方组件直接落进 monorepo 作为可发布的内部包，相比 CLI 拷贝到每个应用的做法：

- 升级集中：所有应用共用同一份组件实现。
- **平铺命名空间**：所有组件都从 `@openconsole/shadcn` 一行导入，不需要按文件路径区分。
- **样式开箱即用**：`@openconsole/shadcn/styles.css` 自带 Tailwind v4 `@theme` 配置与默认明暗变量。
- **附赠**：`cn()` 工具、`<Icon>` 字符串图标渲染、`useIsMobile()`、`<DirectionProvider>`。
- 上层包 `@openconsole/atoms` 在这一层之上做更高层次的组合（Header / Sidebar / Preferences）。

## 安装

```bash
pnpm add @openconsole/shadcn
```

monorepo 内部包消费时需要在 `next.config.ts` 加入 `transpilePackages`，否则 Next.js 不会解析 `.tsx` 源码：

```ts
const nextConfig = {
  transpilePackages: ["@openconsole/shadcn"],
};
```

引入样式（**在所有应用样式之前**）：

```ts
// app/layout.tsx
import "@openconsole/shadcn/styles.css";
```

确保你的 Tailwind 配置/PostCSS 链路工作（Tailwind v4 是 zero-config，绝大多数情况下只要 import 样式即可）。

> **Peer 依赖**：见 [`package.json`](./package.json) `peerDependencies` 字段。Radix UI、`lucide-react`、`class-variance-authority`、`clsx`、`tailwind-merge`、`tailwindcss@^4` 等都必须由应用层提供。

## 用法

```tsx
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@openconsole/shadcn";

export default function Demo() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>登录</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input placeholder="邮箱" />
        <Button className="w-full">提交</Button>
      </CardContent>
    </Card>
  );
}
```

所有组件都是平铺导出 —— **不要**深路径 import：

```ts
// ✅
import { Button } from "@openconsole/shadcn";
// ❌
import { Button } from "@openconsole/shadcn/button";
```

## 组件总览

按 shadcn 的语义分类组织。每个组件在 [shadcn/ui 官网](https://ui.shadcn.com/docs/components) 都能找到详尽文档；本包是它的镜像版本，**API 与 props 与官方一致**。

> 下列为 shadcn 原语；AI 聊天类组件（Thread、ThreadList、MarkdownText、Reasoning …）另见 [assistant-ui 聊天组件](#assistant-ui-聊天组件)。

### 布局 & 容器

| 组件                                                                                                                                                                               | 用途            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`, `CardAction`                                                                                    | 卡片容器        |
| `Separator`                                                                                                                                                                        | 水平/垂直分割线 |
| `AspectRatio`                                                                                                                                                                      | 固定宽高比容器  |
| `ScrollArea`, `ScrollBar`                                                                                                                                                          | 自定义滚动条    |
| `Resizable`, `ResizablePanel`, `ResizableHandle`, `ResizablePanelGroup`                                                                                                            | 可拖拽分屏      |
| `Sidebar`, `SidebarProvider`, `SidebarInset`, `SidebarTrigger`, `SidebarRail`, `SidebarHeader`, `SidebarFooter`, `SidebarContent`, `SidebarGroup`, `SidebarMenu`, … + `useSidebar` | 完整侧边栏体系  |

### 按钮 & 行动元素

| 组件                             | 用途                  |
| -------------------------------- | --------------------- |
| `Button` + `buttonVariants`      | 主按钮组件 + cva 变体 |
| `ButtonGroup`                    | 按钮组合              |
| `Toggle`, `toggleVariants`       | 单击切换按钮          |
| `ToggleGroup`, `ToggleGroupItem` | 多选/单选切换按钮组   |

### 表单输入

| 组件                                                                                                          | 用途                 |
| ------------------------------------------------------------------------------------------------------------- | -------------------- |
| `Input`                                                                                                       | 文本输入             |
| `Textarea`                                                                                                    | 多行文本输入         |
| `Label`                                                                                                       | 表单标签             |
| `Checkbox`                                                                                                    | 复选框               |
| `RadioGroup`, `RadioGroupItem`                                                                                | 单选框组             |
| `Switch`                                                                                                      | 开关                 |
| `Slider`                                                                                                      | 拖动条               |
| `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue`, ...                                  | Radix Select         |
| `NativeSelect`, `NativeSelectContent`, ...                                                                    | 原生 `<select>` 包装 |
| `InputOTP`, `InputOTPGroup`, `InputOTPSlot`, `InputOTPSeparator`                                              | OTP 验证码输入       |
| `Field`, `FieldLabel`, `FieldDescription`, `FieldError`, ...                                                  | 表单字段包装         |
| `InputGroup`, `InputGroupInput`, `InputGroupAddon`, ...                                                       | 输入组（带前后缀）   |
| `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormDescription`, `FormMessage`, `useFormField` | react-hook-form 集成 |

### 反馈

| 组件                                                                                | 用途              |
| ----------------------------------------------------------------------------------- | ----------------- |
| `Alert`, `AlertTitle`, `AlertDescription`                                           | 静态提示横幅      |
| `AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogAction`, ... | 确认对话框        |
| `Toaster`                                                                           | sonner Toast 容器 |
| `Progress`                                                                          | 进度条            |
| `Spinner`                                                                           | 加载圈            |
| `Skeleton`                                                                          | 骨架屏占位        |
| `Empty`, `EmptyHeader`, `EmptyTitle`, `EmptyDescription`, `EmptyContent`, ...       | 空状态            |

### 浮层 & 弹窗

| 组件                                                                      | 用途       |
| ------------------------------------------------------------------------- | ---------- |
| `Dialog`, `DialogTrigger`, `DialogContent`, ...                           | 模态对话框 |
| `Drawer`, `DrawerTrigger`, `DrawerContent`, ...                           | vaul 抽屉  |
| `Sheet`, `SheetTrigger`, `SheetContent`, `SheetHeader`, `SheetTitle`, ... | 侧滑抽屉   |
| `Popover`, `PopoverTrigger`, `PopoverContent`                             | 气泡卡片   |
| `HoverCard`, `HoverCardTrigger`, `HoverCardContent`                       | 悬停卡片   |
| `Tooltip`, `TooltipProvider`, `TooltipTrigger`, `TooltipContent`          | 工具提示   |

### 菜单

| 组件                                                                                                                                                        | 用途               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuLabel`, `DropdownMenuSeparator`, `DropdownMenuShortcut`, ... | 下拉菜单           |
| `ContextMenu`, `ContextMenuTrigger`, `ContextMenuContent`, `ContextMenuItem`, ...                                                                           | 右键菜单           |
| `Menubar`, `MenubarMenu`, `MenubarTrigger`, `MenubarContent`, `MenubarItem`, ...                                                                            | 桌面应用风格菜单栏 |
| `NavigationMenu`, `NavigationMenuList`, `NavigationMenuItem`, `NavigationMenuTrigger`, `NavigationMenuContent`, ...                                         | 多级导航菜单       |
| `Command`, `CommandDialog`, `CommandInput`, `CommandList`, `CommandGroup`, `CommandItem`, `CommandShortcut`, ...                                            | cmdk 命令面板      |

### 数据展示

| 组件                                                                                                                                | 用途              |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableHead`, `TableRow`, `TableCell`, `TableCaption`                            | 表格              |
| `Pagination`, `PaginationContent`, `PaginationItem`, `PaginationLink`, `PaginationPrevious`, `PaginationNext`, `PaginationEllipsis` | 分页器            |
| `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`                                                                                    | 标签页            |
| `Accordion`, `AccordionItem`, `AccordionTrigger`, `AccordionContent`                                                                | 手风琴            |
| `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent`                                                                           | 折叠面板          |
| `Carousel`, `CarouselContent`, `CarouselItem`, `CarouselPrevious`, `CarouselNext`, `useCarousel`                                    | embla 轮播        |
| `Chart`, `ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, ...                                                | recharts 主题集成 |
| `Item`, `ItemGroup`, `ItemHeader`, `ItemTitle`, `ItemDescription`, `ItemContent`, ...                                               | 通用列表项卡片    |

### 工具元素

| 组件                                                                                                                              | 用途                  |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `Avatar`, `AvatarImage`, `AvatarFallback`                                                                                         | 头像                  |
| `Badge`                                                                                                                           | 徽章                  |
| `Kbd`, `KbdGroup`                                                                                                                 | 键盘按键文本          |
| `Breadcrumb`, `BreadcrumbList`, `BreadcrumbItem`, `BreadcrumbLink`, `BreadcrumbPage`, `BreadcrumbSeparator`, `BreadcrumbEllipsis` | 面包屑                |
| `Calendar`, `CalendarDayButton`                                                                                                   | react-day-picker 日历 |

### 工具与公共导出

| 名称                                | 用途                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `cn(...inputs)`                     | `clsx + tailwind-merge`，合并 class 并消除 Tailwind 冲突                     |
| `Icon`                              | 按名称字符串渲染 `lucide-react` 图标，便于在 RSC ↔ Client 间传递可序列化数据 |
| `useIsMobile()`                     | 监听 `(max-width: 767px)`，返回当前是否为移动端宽度                          |
| `DirectionProvider`, `useDirection` | Radix Direction（LTR / RTL），影响所有 Radix 子项的方向感知                  |

## 示例

### `cn()` 合并 class

```ts
import { cn } from "@openconsole/shadcn";

<button
  className={cn(
    "rounded-md px-3 py-1",
    isPrimary && "bg-primary text-primary-foreground",
    className,                   // 调用方覆盖
  )}
/>
```

`twMerge` 自动消除 Tailwind 冲突（例如 `px-2` 与 `px-4` 写一起会保留后写的）。

### `<Icon>` 字符串图标

Sider / 菜单等数据结构里把图标存成字符串可以让 Server Component 安全传给 Client Component。`<Icon>` 在 client 端查表渲染：

```tsx
import { Icon } from "@openconsole/shadcn";

const menu = [
  { label: "概览", icon: "LayoutDashboard", href: "/dashboard" },
  { label: "订单", icon: "ShoppingCart", href: "/orders" },
];

<Icon name={menu[0].icon} className="size-4" />;
```

`name` 不存在时返回 `null`，不会抛错。

### `useIsMobile()` 响应式分支

```tsx
import { useIsMobile } from "@openconsole/shadcn";

function Page() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
```

第一次 mount 前返回 `false`（SSR 安全）。

### `<DirectionProvider>` RTL

```tsx
import { DirectionProvider } from "@openconsole/shadcn";

<DirectionProvider direction="rtl">{/* 所有 Radix 子项自动按右到左渲染 */}</DirectionProvider>;
```

### `<Sidebar>` 完整骨架

shadcn 的 sidebar 体系自包含。如果你只用到底层原语：

```tsx
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarInset, SidebarProvider, SidebarRail } from "@openconsole/shadcn";

<SidebarProvider>
  <Sidebar>
    <SidebarHeader>{/* 品牌 */}</SidebarHeader>
    <SidebarContent>{/* 菜单 */}</SidebarContent>
    <SidebarFooter>{/* 账号 */}</SidebarFooter>
    <SidebarRail />
  </Sidebar>
  <SidebarInset>{children}</SidebarInset>
</SidebarProvider>;
```

要更高层的封装，请直接使用 `@openconsole/atoms` 的 `<Sidebar>`。

### Form + react-hook-form + zod

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button, Form, FormControl, FormField, FormItem, FormLabel, FormMessage, Input } from "@openconsole/shadcn";

const schema = z.object({ email: z.string().email() });

function SignIn() {
  const form = useForm({ resolver: zodResolver(schema) });
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => signIn(v))}>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>邮箱</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit">登录</Button>
      </form>
    </Form>
  );
}
```

## 主题与 Token

`@openconsole/shadcn/styles.css` 包含三部分：

1. `@theme inline { … }` —— 把 CSS 变量映射成 Tailwind v4 设计 token（`bg-primary` ↔ `var(--primary)`）。
2. `:root { … }` —— light 模式的默认 OKLCH 配色。
3. `.dark { … }` —— dark 模式的默认 OKLCH 配色。

### 自定义主题

直接覆盖 CSS 变量即可：

```css
:root {
  --primary: oklch(0.6 0.2 250);
  --primary-foreground: oklch(0.98 0 0);
  --radius: 0.5rem;
}
```

或者使用 `@openconsole/atoms` 的 `<Preferences>` 抽屉做运行时实时编辑（包含 shadcn / tweakcn 数百套预设、品牌色按 token 编辑、CSS 粘贴导入）。

### `next-themes` 接入

通常配合 `<ThemeProvider attribute="class">` 切换 `.dark` 类名。直接用本包：

```tsx
import { ThemeProvider } from "next-themes";

<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
  {children}
</ThemeProvider>;
```

或使用 `@openconsole/atoms` 的 `<ThemeProvider>`（带默认值的薄包装）。

## 目录结构与维护

本包采用 **shadcn 标准工程布局**，让官方 CLI（`add` / `diff`）与 assistant-ui registry 原生可用：

```
packages/shadcn/
├─ components/
│  ├─ ui/<name>.tsx             # shadcn 原语（56 个）
│  ├─ ui/index.ts               #   └ barrel
│  ├─ assistant-ui/<name>.tsx   # assistant-ui 聊天组件（34 个）
│  ├─ assistant-ui/index.ts     #   └ barrel（badge/select/tabs/accordion 与 ui 重名，不进公共导出，见下）
│  ├─ icons/github.tsx          # ThreadListSidebar 用到的内部图标
│  └─ index.ts                  # ui + assistant-ui 合并 barrel
├─ lib/utils.ts                 # cn()
├─ hooks/use-mobile.ts          # useIsMobile()
├─ components.json              # shadcn / assistant-ui CLI 配置（add / diff）
├─ index.ts                     # 根 barrel：lib + hooks + components
├─ env.d.ts                     # 本包 tsc 用的 *.css 环境声明
└─ styles.css
```

对外只有两个入口：

| 入口                             | 内容                                                         |
| -------------------------------- | ------------------------------------------------------------ |
| `@openconsole/shadcn`            | 全部 —— UI 原语 + 工具 + assistant-ui 聊天组件，一行平铺导入 |
| `@openconsole/shadcn/styles.css` | 主题与 token                                                 |

### 核心不变量：无构建 ⇒ 相对导入

本包**不构建**、直接发布 `.tsx`，由消费方 `transpilePackages` 编译。`@/` 这类路径别名**跨包不可解析**（在消费方会被它自己的 `@/` 接管），所以：

> **仓库里的源码一律相对导入**（`../../lib/utils`、`../ui/button`），不留 `@/`。

`components.json` 的 `@/` 别名与 `tsconfig.json` 的 `paths` **仅供 CLI 解析**。`shadcn add`（或 `assistant-ui add`）生成的文件会带 `@/`，需**手动**按文件位置改回相对路径：`@/lib/utils` → `../../lib/utils`；引用 UI 原语 `@/components/ui/x` 在 assistant-ui 里写 `../ui/x`、在 ui 内部写 `./x`。新增组件别忘了补进对应目录的 `index.ts` barrel。

## 升级 shadcn 原组件

组件与官方同名同位（`components/ui/<name>.tsx`），`shadcn diff` 原生可用：

```bash
cd packages/shadcn
npx shadcn@latest diff <component>              # 看官方 registry 与本地实现的差异
npx shadcn@latest add  <component> --overwrite  # 拉最新实现覆盖本地
# 手动：把生成文件里的 @/ 改成相对路径；若是新增组件，加进 components/ui/index.ts
pnpm typecheck                                  # 校验
```

> `diff` 的 import 行会恒显示差异（官方用 `@/`、本地用相对）—— 这是无构建分发的取舍，**看组件主体逻辑即可**。本包的品牌定制集中在 `styles.css` 的 CSS 变量、而非组件源码，故覆盖通常不冲突。

## assistant-ui 聊天组件

[assistant-ui](https://www.assistant-ui.com) 的聊天组件（**34 个**）已 vendor 进 `components/assistant-ui/`，构建在本包的 shadcn 原语之上，与 UI 原语一起从根 barrel 平铺导出：

```tsx
import { MarkdownText, Thread, ThreadList } from "@openconsole/shadcn";
```

### 组件总览

> 每个组件在 [assistant-ui 官网](https://www.assistant-ui.com/docs) 都有详尽文档；本包是其 registry 的镜像，**API 与上游一致**。下表只列主导出，子组件（`*Root` / `*Trigger` / `*Content` …）随同名 `export *` 一并平铺导出。

#### 会话外壳

| 组件                | 用途                                           |
| ------------------- | ---------------------------------------------- |
| `Thread`            | 完整对话线程（消息列表 + Composer + 自动滚动） |
| `ThreadList`        | 会话列表                                       |
| `ThreadListSidebar` | 带会话列表的侧边栏                             |
| `AssistantModal`    | 悬浮弹窗式助手                                 |
| `AssistantSidebar`  | 停靠式侧边助手                                 |

#### 消息内容渲染

| 组件                                                                       | 用途                             |
| -------------------------------------------------------------------------- | -------------------------------- |
| `MarkdownText`                                                             | 流式 Markdown 渲染（remark-gfm） |
| `Reasoning`（`ReasoningRoot` / `ReasoningTrigger` / `ReasoningContent` …） | 思维链 / reasoning 折叠块        |
| `Sources`（`Source` / `SourceTitle`）                                      | 引用来源                         |
| `Quote`（`QuoteBlock` / `SelectionToolbar`）                               | 选区引用工具条 + 引用块          |
| `ToolFallback`（`ToolFallbackRoot` …）                                     | 默认工具调用 UI                  |
| `ToolGroup`（`ToolGroupRoot` …）                                           | 工具调用分组                     |
| `Image`（`ImageRoot` / `ImagePreview`）                                    | 图片消息片段                     |
| `File`（`FileRoot` / `FileName` / `FileSize`）                             | 文件消息片段                     |
| `DirectiveText`（`createDirectiveText`）                                   | 指令 / 斜杠命令文本渲染          |

#### 输入区 & 控制

| 组件                                                                                       | 用途                              |
| ------------------------------------------------------------------------------------------ | --------------------------------- |
| `Attachment`（`ComposerAttachments` / `UserMessageAttachments` / `ComposerAddAttachment`） | 附件上传与展示                    |
| `ComposerTriggerPopover`                                                                   | Composer 弹出触发器（斜杠命令等） |
| `FollowUpSuggestions`（`ThreadFollowupSuggestions`）                                       | 跟进建议气泡                      |
| `ModelSelector`                                                                            | 模型 + effort 选择器              |
| `Voice`（`VoiceOrb` / `VoiceControl` / `VoiceConnectButton` …）                            | 语音模式 UI                       |
| `McpConfigDialog`                                                                          | MCP 服务器配置对话框              |

#### 代码 & 图表

| 组件                                           | 用途                            |
| ---------------------------------------------- | ------------------------------- |
| `SyntaxHighlighter`                            | react-syntax-highlighter 代码块 |
| `ShikiSyntaxHighlighter`（`HighlighterProps`） | Shiki 代码块                    |
| `MermaidDiagram`（`MermaidZoom`）              | Mermaid 图渲染                  |
| `DiffViewer`                                   | 代码 diff 渲染                  |

#### 数据 & 状态可视化

| 组件                                                             | 用途                |
| ---------------------------------------------------------------- | ------------------- |
| `MessageTiming`                                                  | 消息耗时 / 时序展示 |
| `ContextDisplay`（`ContextDisplayRing` / `ContextDisplayBar` …） | 上下文窗口用量指示  |
| `NumberRoll`                                                     | 数字滚动动画        |
| `DotMatrix`（`dotMatrixStates`）                                 | 点阵状态动画        |
| `HeatGraph`                                                      | 贡献热力图          |

#### 共享原语

| 组件                | 用途                                                  |
| ------------------- | ----------------------------------------------------- |
| `TooltipIconButton` | 带 tooltip 的图标按钮（被多数 assistant-ui 组件复用） |

### 与 ui 重名的组件（仅作 registry 对齐）

assistant-ui 另有 4 个组件与 shadcn 原语同名：`Badge`、`Select`、`Tabs`、`Accordion`。平铺命名空间里 **shadcn 原语优先**，这 4 个 assistant-ui 变体**不进根 barrel**；本包对外只暴露 `.` 与 `./styles.css` 两个入口（无深路径），故它们**不属于公共 API**。

保留源码是为了让 `shadcn diff` / registry 与上游 1:1 对齐 —— assistant-ui 版相比 shadcn 版多了若干变体（如 `Tabs` 的动画指示器与 `line/ghost/pills/outline`、`Badge` 的 `info/warning/success/destructive`）。其中 `badge` 还被 `directive-text`、`sources` 以相对路径内部复用。若应用要用这些变体，把对应文件用 `shadcn add` 拉进自己的项目即可。

### 依赖

核心运行时 `@assistant-ui/react` 为**必需** peer；`MarkdownText` 额外需要 `@assistant-ui/react-markdown` + `remark-gfm`。其余按组件登记为**可选** peer（`peerDependenciesMeta.optional`），只在用到对应组件时才需安装：

| 组件                     | 可选依赖                                                |
| ------------------------ | ------------------------------------------------------- |
| AI SDK 运行时绑定        | `@assistant-ui/react-ai-sdk`                            |
| `McpConfigDialog`        | `@assistant-ui/react-mcp`                               |
| `SyntaxHighlighter`      | `react-syntax-highlighter`                              |
| `ShikiSyntaxHighlighter` | `react-shiki`、`@assistant-ui/react-syntax-highlighter` |
| `MermaidDiagram`         | `beautiful-mermaid`                                     |
| `DiffViewer`             | `diff`、`parse-diff`                                    |
| `HeatGraph`              | `heat-graph`                                            |

> 完整 peer 列表见 [`package.json`](./package.json)。根 barrel 含全部组件，TS 会解析其类型 ⇒ 消费方需装齐**用到的**组件依赖。`transpilePackages` 默认已覆盖本包；带 `*.css` 副作用导入由打包器处理（Next 默认 OK）。源码为 **ES2022 可移植**，消费方无需 `es2023` lib。

### 升级

assistant-ui 走 shadcn 兼容 registry，可直接按官方 URL 拉取：

```bash
cd packages/shadcn
npx shadcn@latest add "https://r.assistant-ui.com/<name>.json"   # 例：thread、reasoning、tool-group
# 手动：把生成文件里的 @/lib/utils 改成相对 ../../lib/utils；
#       新增组件加进 components/assistant-ui/index.ts（与 ui 重名的 badge/select/tabs/accordion 除外，见上）
pnpm install && pnpm typecheck
```

> 升级时若 effect 出现「部分路径 return 值、部分隐式落空」，需手改以满足本包 tsconfig 的 `noImplicitReturns`。改完 `pnpm typecheck` 应为 0 报错。

## 与 shadcn/ui CLI 的差异

| 维度       | `@openconsole/shadcn`                              | `npx shadcn add`                           |
| ---------- | -------------------------------------------------- | ------------------------------------------ |
| 分发方式   | 包，集中升级                                       | 拷贝到应用，分散维护                       |
| 导入方式   | 平铺 `from "@openconsole/shadcn"`                  | 按文件路径 `from "@/components/ui/button"` |
| 样式       | `import "@openconsole/shadcn/styles.css"` 一行就位 | 拷贝 `globals.css` 后手工维护              |
| 升级       | 升级包                                             | 重新 add + 手工 diff                       |
| 跨应用复用 | 一份代码 N 个应用                                  | N 份相同代码                               |
| 修改组件   | 改源码即可，monorepo 内立刻生效                    | 自由度更高                                 |

## 常见问题

**Q：为什么导入路径里没有 `/button` / `/card`？**
A：本包用嵌套 barrel 把 UI 原语与 assistant-ui 聊天组件都从 `@openconsole/shadcn` 一行导出，升级只改一处 `import`；对外只有 `.` 与 `./styles.css` 两个入口，深路径不受支持。

**Q：我能像 shadcn CLI 那样直接改组件源码吗？**
A：能。monorepo 内 `packages/shadcn/components/ui/<component>.tsx` 是直接源码，按 `transpilePackages` 配置编译到应用。改完立刻看到效果。但请注意改动会影响所有依赖该组件的应用，且会让该组件后续的 `shadcn diff` 噪音变大。

**Q：为什么需要传给 `<Icon>` 字符串而不是直接 React 组件？**
A：菜单 / 导航这类数据结构会被 RSC ↔ Client 间传递。React 组件不可序列化，字符串可以。把图标查表延迟到 Client 端做。

**Q：`useIsMobile()` 的断点能改吗？**
A：当前断点是 `768px`，硬编码在 [`hooks/use-mobile.ts`](./hooks/use-mobile.ts)。需要不同断点就直接用 `window.matchMedia` 自己写一个。

**Q：Tailwind v4 配置去哪了？**
A：v4 是 zero-config。本包通过 `styles.css` 里的 `@source "./**/*.{ts,tsx}"` 和 `@theme inline { … }` 完成等价的「配置」。应用层无需再写 `tailwind.config.js`。

## 与 `@openconsole/atoms` 的关系

`@openconsole/atoms` 在本包之上做了更高层的组合：

| 层次              | 包                    | 关注点                                                |
| ----------------- | --------------------- | ----------------------------------------------------- |
| 设计 token + 原语 | `@openconsole/shadcn` | 按钮 / 输入 / 弹窗 / 分页…                            |
| 业务级骨架        | `@openconsole/atoms`  | Header / Sidebar / Breadcrumbs / 错误页 / Preferences |

只用得到原语：直接 `@openconsole/shadcn`。要做后台骨架：装 `@openconsole/atoms`（它已经把 shadcn 列为 peer 依赖）。

## License

参见仓库根目录的 LICENSE。

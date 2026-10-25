import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * 分层边界的机检。
 *
 * 这个包的核心主张是"算法只吃 {@link Structure} 的五个字段，跟 `Graph` 无关"。主张要靠
 * **依赖方向**坐实：只要 `core/algorithm/**` 里有一个文件 import 了 `../graph` 或
 * `../snapshot`，整个算法层就把编辑层拖进了传递依赖，那句话立刻退化成一句注释。
 *
 * 这类边界从来不是被一次大重构破坏的，而是被某次"就加一行 import"顺手拆掉的——那一行
 * 单看永远无可指摘。所以把它写成断言而不是约定。
 */

const CORE = join(import.meta.dirname, "..", "..", "core");
const ROOT = join(CORE, "..");

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });

const importsOf = (file: string): string[] =>
  [...readFileSync(file, "utf8").matchAll(/from "([^"]+)"/g)].map((m) => m[1]!);

const relative = (file: string): string =>
  file.slice(CORE.length + 1).replaceAll("\\", "/");

describe("模块分层", () => {
  const files = sources(CORE);

  it("core/ 下的文件都被扫到了", () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it.each([
    "../graph",
    "../snapshot",
    "../compile",
    "../ordering",
    "../hierarchy",
    "../journal",
  ])("算法层不依赖 %s", (forbidden) => {
    const offenders = files
      .filter((file) => relative(file).startsWith("algorithm/"))
      .filter((file) => importsOf(file).includes(forbidden))
      .map(relative);
    expect(offenders).toEqual([]);
  });

  it("契约层不依赖编译器与编辑层", () => {
    expect(importsOf(join(CORE, "structure.ts")).sort()).toEqual([
      "./array",
      "./error",
    ]);
  });

  it("索引原语是零依赖叶子", () => {
    for (const leaf of ["array.ts", "ident.ts", "slots.ts", "socket.ts"]) {
      expect(importsOf(join(CORE, leaf))).toEqual([]);
    }
  });

  /**
   * 编译器只往一个方向认人：它认识图与契约，而 {@link Snapshot} 只认得编译结果。
   * 反过来让编译机器散回 `snapshot.ts`，那个文件就会重新变成"一半是容器、一半是编译器"。
   */
  it("编译器不反向依赖增量序与层级", () => {
    const linked = importsOf(join(CORE, "compile.ts")).sort();
    expect(linked).not.toContain("./ordering");
    expect(linked).not.toContain("./hierarchy");
  });

  it("算法之间只在真正组合时才互相依赖", () => {
    const siblings = new Map<string, string[]>();
    for (const file of files) {
      const name = relative(file);
      if (!name.startsWith("algorithm/") || name.endsWith("index.ts")) continue;
      const linked = importsOf(file)
        .filter((source) => source.startsWith("./"))
        .map((source) => source.slice(2));
      if (linked.length > 0) siblings.set(name, linked.sort());
    }
    // reach 的闭包必须先缩点、可达集要走 dfs——这两条是算法本身的组合关系，留着。
    // 其余任何一条都说明有段公共代码被塞进了某个算法模块，该往 `array.ts` 收。
    expect(Object.fromEntries(siblings)).toEqual({
      "algorithm/reach.ts": ["component", "search"],
    });
  });
});

/**
 * 打包产物的机检。
 *
 * 上面那组断言读的是 import 语句——它管得住依赖方向，管不住「摇树到底摇掉了没有」。撤掉
 * `./algorithm` 子路径之后，「Worker 里只跑算法不打包编辑层」从结构保证降成了打包器行为，
 * 而行为只能拿产物验：子路径那套的导出一直是残缺的、README 的示例一直跑不通，没被发现的
 * 原因就是没有任何东西盯着它。
 */

/** 打一次包，取产物里的顶层声明名。 */
const declared = async (entry: string): Promise<string[]> => {
  const { outputFiles } = await build({
    stdin: {
      contents: entry,
      resolveDir: ROOT,
      sourcefile: "entry.ts",
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    treeShaking: true,
  });
  // esbuild 遇同名会加数字后缀，剥掉再比，免得哪天多一处重名就漏判。
  return [
    ...outputFiles[0]!.text.matchAll(
      /^(?:function|var|const|let|class) (\w+)/gm,
    ),
  ].map((match) => match[1]!.replace(/\d+$/, ""));
};

describe("打包产物", () => {
  let algorithm: string[];

  beforeAll(async () => {
    algorithm = await declared(
      `export { scc, settle, toposort } from "./index";`,
    );
  }, 30_000);

  it("算法本身在产物里", () => {
    for (const kept of ["toposort", "scc", "settle", "Stepwise"]) {
      expect(algorithm).toContain(kept);
    }
  });

  it.each([
    "Graph",
    "Journal",
    "Signal",
    "Hierarchy",
    "Ordering",
    "Snapshot",
    "pack",
    "diff",
  ])("只用算法时摇掉了 %s", (symbol) => {
    expect(algorithm).not.toContain(symbol);
  });

  /**
   * 没有这一条，上面那组断言在「检测本身失灵」时照样全绿——产物格式换了、正则再也匹配不到
   * 任何声明，结论就成了"什么都没漏"。所以另起一个确实用到编辑层的入口，要求它一定被抓到。
   */
  it("真漏进来时抓得到", async () => {
    const editing = await declared(`export { Graph } from "./index";`);
    for (const leaked of ["Graph", "Journal", "Signal", "Hierarchy"]) {
      expect(editing).toContain(leaked);
    }
  }, 30_000);
});

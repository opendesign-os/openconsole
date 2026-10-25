import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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

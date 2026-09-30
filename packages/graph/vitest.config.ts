import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 快照改用 WeakRef 持源图，验证"源图确实可回收"需要手动触发 GC。
    execArgv: ["--expose-gc"],
  },
});

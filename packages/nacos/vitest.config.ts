import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["core/**/*.ts", "adapters/**/*.ts"],
    },
  },
});

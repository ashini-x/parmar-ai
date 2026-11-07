import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["workers/vrain/test/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});

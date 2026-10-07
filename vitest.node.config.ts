import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/admin-access-ui.test.ts", "test/native-quiz-contract.node.test.ts"],
  },
});

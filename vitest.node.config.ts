import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "test/admin-access-ui.test.ts",
      "test/native-quiz-contract.node.test.ts",
      "test/fatman-retrieval.test.ts",
      "test/fatman-admin-contract.node.test.ts",
      "test/fatman-admin.test.ts",
    ],
  },
});

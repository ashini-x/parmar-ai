import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "test/admin-access-ui.test.ts",
      "test/admin-student-conversations.test.ts",
      "test/native-quiz-contract.node.test.ts",
      "test/fatman-retrieval.test.ts",
      "test/fatman-admin-contract.node.test.ts",
      "test/fatman-admin.test.ts",
      "test/brvin-admin-script.node.test.ts",
      "test/brvin-m15-passage-qrels-validator.node.test.mjs",
      "test/production-release-acceptance.node.test.mjs",
    ],
  },
});

import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.test.jsonc" },
      miniflare: { compatibilityDate: "2026-09-22" }
    })
  ],
  test: {
    include: ["test/**/*.test.ts"],
    exclude: [
      "test/admin-access-ui.test.ts",
      "test/native-quiz-contract.node.test.ts",
      "test/fatman-retrieval.test.ts",
      "test/fatman-admin-contract.node.test.ts"
    ]
  }
});

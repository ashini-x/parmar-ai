import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { compatibilityDate: "2026-09-22" }
    })
  ],
  test: {
    exclude: ["test/admin-access-ui.test.ts"]
  }
});

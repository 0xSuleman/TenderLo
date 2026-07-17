import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      reporter: ["text", "lcov"]
    }
  },
  resolve: {
    alias: {
      "@tenderlo/shared": resolve(__dirname, "packages/shared/src/index.ts"),
      "@tenderlo/db": resolve(__dirname, "packages/db/src/index.ts"),
      "@tenderlo/sources": resolve(__dirname, "packages/sources/src/index.ts"),
      "@tenderlo/parsing": resolve(__dirname, "packages/parsing/src/index.ts"),
      "@tenderlo/intelligence": resolve(__dirname, "packages/intelligence/src/index.ts"),
      "@tenderlo/scoring": resolve(__dirname, "packages/scoring/src/index.ts"),
      "@tenderlo/notifications": resolve(__dirname, "packages/notifications/src/index.ts")
    }
  }
});

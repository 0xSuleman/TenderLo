import { defineConfig } from "vitest/config";

const root = "/Users/macbookpro/Desktop/TenderLo";

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
      "@tenderlo/shared": `${root}/packages/shared/src/index.ts`,
      "@tenderlo/intelligence": `${root}/packages/intelligence/src/index.ts`,
      "@tenderlo/scoring": `${root}/packages/scoring/src/index.ts`,
      "@tenderlo/parsing": `${root}/packages/parsing/src/index.ts`,
      "@tenderlo/sources": `${root}/packages/sources/src/index.ts`,
      "@tenderlo/db": `${root}/packages/db/src/index.ts`,
      "@tenderlo/notifications": `${root}/packages/notifications/src/index.ts`,
    }
  }
});

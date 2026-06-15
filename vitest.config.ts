import { defineConfig } from "vitest/config";

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
      "@tenderlo/shared": "/home/suleman-ahmed/Documents/TenderLo/packages/shared/src/index.ts",
      "@tenderlo/intelligence": "/home/suleman-ahmed/Documents/TenderLo/packages/intelligence/src/index.ts",
      "@tenderlo/scoring": "/home/suleman-ahmed/Documents/TenderLo/packages/scoring/src/index.ts",
      "@tenderlo/parsing": "/home/suleman-ahmed/Documents/TenderLo/packages/parsing/src/index.ts"
    }
  }
});

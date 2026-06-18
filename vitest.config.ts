import { defineConfig } from "vitest/config";

// Tests live in test/ (outside src/, so they're never compiled into dist or bundled
// into the pkg exe). Vitest transpiles the TS sources on the fly via esbuild.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});

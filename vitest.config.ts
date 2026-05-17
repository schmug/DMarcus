import { defineConfig } from "vitest/config";

// Plain Node pool — every test mocks `fetch`, so no browser/Workers runtime
// is needed. The DoH client and orchestrator are exercised against canned
// Cloudflare/Google DoH JSON fixtures.
export default defineConfig({
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
  },
});

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "url";

// Exercise integration tests (*.int.test.ts) run against TEST_DATABASE_URL, a
// separate database whose name ends in _test (never the dev one), and are
// skipped when it is not set. They share that database, so test files run
// one at a time while it is set.
const testDbUrl = process.env.TEST_DATABASE_URL ?? "";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", ".next", "e2e"],
    ...(testDbUrl
      ? {
          fileParallelism: false,
          testTimeout: 30_000,
          env: { TEST_DATABASE_URL: testDbUrl, DATABASE_URL: testDbUrl, AUTH_SECRET: "test-secret-0123456789abcdef0123456789abcdef", MASTER_KEK: "ab".repeat(32) },
        }
      : {}),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});

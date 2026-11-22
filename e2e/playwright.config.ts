import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./stack";

// Release-gate smoke suite. See CONTRIBUTING.md, "Running the e2e suite".
//
// The specs run in file order, one worker, because state flows from one to the
// next (setup -> invites -> incident -> paging -> lock -> close -> export ...).
// global-setup builds and starts the Docker stack (project ce-e2e, port 3200)
// and global-teardown removes it with `down -v`.
//   E2E_EXTERNAL_STACK=1  reuse a stack that is already up (skip up and down)
//   E2E_KEEP_STACK=1      leave the stack running after the run (debugging)
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  reporter: [["list"], ["html", { open: "never", outputFolder: "../playwright-report" }]],
  outputDir: "../test-results",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    acceptDownloads: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

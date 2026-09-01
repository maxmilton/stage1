import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  failOnFlakyTests: Boolean(process.env["CI"]),
  forbidOnly: Boolean(process.env["CI"]),
  // Every test is independent: each gets a fresh page, and the document-level
  // click listener in browser-events.spec.ts belongs to that page, not the
  // process. Parallel execution also enforces that (CLAUDE.md R5).
  fullyParallel: true,
  globalSetup: "./test/e2e/global-setup.ts",
  retries: process.env["CI"] ? 1 : 0,
  use: {
    acceptDownloads: false,
    contextOptions: { strictSelectors: true },
    locale: "en-US",
    offline: true, // no external network requests necessary
    timezoneId: "UTC",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chromium" },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    // FIXME: Broken in both CI and on local dev machines.
    // {
    //   name: "webkit",
    //   use: { ...devices["Desktop Safari"] },
    // },
  ],
});

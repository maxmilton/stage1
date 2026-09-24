// oxlint-disable node/no-process-env

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  failOnFlakyTests: Boolean(process.env["CI"]),
  forbidOnly: Boolean(process.env["CI"]),
  fullyParallel: true,
  // repeatEach: 3, // uncomment to detect flaky tests
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

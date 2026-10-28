// oxlint-disable node/no-process-env

import { defineConfig, devices } from "@playwright/test";

// eslint-disable-next-line unicorn/no-top-level-side-effects
export default defineConfig({
  testDir: "test/e2e",
  failOnFlakyTests: Boolean(process.env["CI"]),
  forbidOnly: Boolean(process.env["CI"]),
  fullyParallel: true,
  globalTimeout: 8 * 60 * 1000, // 8 minutes (keep under CI timeout)
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
    { name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chromium" } },
    { name: "firefox", use: devices["Desktop Firefox"] },
    { name: "webkit", use: devices["Desktop Safari"], default: false }, // to include use --project='*'
  ],
});

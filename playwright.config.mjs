import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'test/e2e',
  testMatch: 'test/e2e/**/*.spec.ts',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    acceptDownloads: false,
    contextOptions: { strictSelectors: true },
    locale: 'en-US',
    offline: true, // no networking necessary
    timezoneId: 'UTC',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    // FIXME: Uncomment for CI (broken on local Arch Linux dev machine)
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],
});

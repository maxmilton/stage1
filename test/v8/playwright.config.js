// One-off V8 probes, not part of test:e2e: bun run test:v8
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]), // oxlint-disable-line node/no-process-env
  use: {
    channel: "chromium",
    // Playwright's default --disable-field-trial-config keeps V8 out of TurboFan
    launchOptions: { ignoreDefaultArgs: ["--disable-field-trial-config"] },
  },
});

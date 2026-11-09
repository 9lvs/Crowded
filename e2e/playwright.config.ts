import { defineConfig, devices } from "@playwright/test";

const CI = !!process.env.CI;

export default defineConfig({
  testDir: "./tests",
  // Real backend tests share one seeded DB and rate limits, so keep runs predictable.
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:8000",
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "iphone-chromium",
      use: { ...devices["iPhone 14"], browserName: "chromium" },
    },
  ],
});

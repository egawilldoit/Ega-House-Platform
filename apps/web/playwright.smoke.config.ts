import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: /smoke-public\.e2e\.spec\.ts$/,
  projects: [{ name: "chromium-smoke", use: { viewport: { width: 1280, height: 800 } } }],
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  failOnFlakyTests: Boolean(process.env.CI),
  timeout: 25_000,
  globalTimeout: process.env.CI ? 240_000 : undefined,
  reporter: [[process.env.CI ? "line" : "list"], ["json", { outputFile: "test-results/smoke-results.json" }]],
  use: { ...base.use, trace: "off", screenshot: "off", video: "off" },
});

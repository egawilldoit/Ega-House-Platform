import { defineConfig } from "@playwright/test";
import { readLocalEnvironment } from "../../scripts/e2e/local-env.cjs";

const env = readLocalEnvironment();

export default defineConfig({
  testDir: "./tests",
  testMatch: ["auth-session.e2e.spec.ts", "disposable-journeys.e2e.spec.ts", "kanban-board.e2e.spec.ts", "pwa-personal-operations.e2e.spec.ts", "pwa-morning-startup.e2e.spec.ts"],
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: true,
  failOnFlakyTests: true,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  globalTimeout: 15 * 60_000,
  reporter: [["list"], ["json", { outputFile: "test-results/disposable-results.json" }]],
  use: { baseURL: env.E2E_AUTH_BASE_URL, trace: "off", screenshot: "off", video: "off" },
  webServer: {
    command: "node ../../scripts/e2e/with-env.mjs npm run start -- --port 3000 --hostname 127.0.0.1",
    url: env.E2E_AUTH_BASE_URL,
    reuseExistingServer: process.env.E2E_REUSE_OWNED_SERVER === "1" && !process.env.CI,
    timeout: 120_000,
    env,
  },
  projects: [{ name: "chromium-disposable", use: { viewport: { width: 1280, height: 900 }, timezoneId: "Africa/Casablanca" } }],
});

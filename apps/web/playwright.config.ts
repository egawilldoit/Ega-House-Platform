import { defineConfig } from "@playwright/test";

const webkitEnabled = process.env.PWA_E2E_WEBKIT === "1";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run start --workspace @ega/web -- --port 3000 --hostname 127.0.0.1",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    env: {
      DATABASE_URL: "postgres://dummy",
      NEXT_PUBLIC_SUPABASE_URL: "https://dummy.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "dummy",
      SUPABASE_SERVICE_ROLE_KEY: "dummy",
    },
  },
  projects: [
    {
      name: "chromium-phone-390",
      testMatch: /pwa-.*\.e2e\.spec\.ts/,
      use: { viewport: { width: 390, height: 844 } },
    },
    {
      name: "chromium-phone-320",
      testMatch: /pwa-.*\.e2e\.spec\.ts/,
      use: { viewport: { width: 320, height: 844 } },
    },
    {
      name: "chromium-desktop",
      use: { viewport: { width: 1280, height: 800 } },
    },
    ...(webkitEnabled
      ? [
          {
            name: "webkit-phone-390",
            testMatch: /pwa-.*\.e2e\.spec\.ts/,
            use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
          },
        ]
      : []),
  ],
});

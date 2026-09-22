import { defineConfig } from "@playwright/test";

const webkitEnabled = process.env.PWA_E2E_WEBKIT === "1";

export default defineConfig({
  testDir: "./tests",
  testMatch: /pwa-.*\.e2e\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 180_000,
  use: {
    baseURL: process.env.E2E_AUTH_BASE_URL ?? "https://www.egawilldoit.online",
    trace: "off",
  },
  projects: [
    {
      name: "chromium-phone-390",
      use: { viewport: { width: 390, height: 844 } },
    },
    {
      name: "chromium-desktop",
      use: { viewport: { width: 1280, height: 800 } },
    },
    ...(webkitEnabled
      ? [
          {
            name: "webkit-phone-390",
            use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
          },
        ]
      : []),
  ],
});

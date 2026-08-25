import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
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
});

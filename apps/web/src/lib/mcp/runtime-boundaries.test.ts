import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("MCP Next route remains a thin lazy endpoint adapter", () => {
  const route = source("src/app/api/mcp/route.ts");

  assert.match(route, /createLazyMcpEndpoint/);
  assert.match(route, /endpoint\.GET\(request\)/);
  assert.match(route, /endpoint\.POST\(request\)/);
  assert.match(route, /endpoint\.OPTIONS\(\)/);
  assert.doesNotMatch(route, /createAdminClient|getSupabaseServiceClient|\.from\(/);
});

test("MCP endpoint preserves feature gating and disabled 404 behavior", () => {
  const endpoint = source("src/lib/mcp/endpoint.ts");

  assert.match(endpoint, /MCP_ENABLED === "true"/);
  assert.match(endpoint, /MCP endpoint is disabled\./);
  assert.match(endpoint, /status: 404/);
  assert.match(endpoint, /createMcpRouteRuntime/);
});

test("Google Calendar callback preserves state validation and token exchange", () => {
  const callback = source(
    "src/app/api/integrations/google-calendar/callback/route.ts",
  );

  assert.match(callback, /GOOGLE_CALENDAR_OAUTH_STATE_COOKIE/);
  assert.match(callback, /validateGoogleCalendarCallback/);
  assert.match(callback, /exchangeGoogleCalendarCodeForTokens/);
  assert.match(callback, /connectGoogleCalendarWithTokens/);
});

test("production cron routes share the common authorization boundary", () => {
  const paths = [
    "src/app/api/cron/calendar-sync/route.ts",
    "src/app/api/cron/task-reminders/route.ts",
    "src/app/api/cron/daily-email/route.ts",
    "src/app/api/cron/_lib/send-weekly-reviews.ts",
  ];

  for (const path of paths) {
    assert.match(source(path), /authorizeCronRequest/);
  }
});

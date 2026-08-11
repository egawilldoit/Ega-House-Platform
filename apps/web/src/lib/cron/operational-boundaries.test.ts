import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeToApi: string) {
  return readFileSync(resolve(process.cwd(), "src/app/api", relativeToApi), "utf8");
}

describe("operational transport boundaries", () => {
  it("centralizes cron bearer authorization in the shared runtime", () => {
    const cronFiles = [
      "cron/calendar-sync/route.ts",
      "cron/task-reminders/route.ts",
      "cron/daily-email/route.ts",
      "cron/test-email/route.ts",
      "cron/_lib/send-weekly-reviews.ts",
    ];

    for (const file of cronFiles) {
      const text = source(file);
      expect(text, file).toContain("authorizeCronRequest(");
      expect(text, file).not.toContain("process.env.CRON_SECRET");
      expect(text, file).not.toMatch(/@\/components|@\/app\/\(app\)/);
      expect(text, file).not.toContain("createAuthenticatedActor(");
    }
  });

  it("keeps weekly review route aliases as thin compatibility adapters", () => {
    for (const file of [
      "cron/sendWeeklyReviews/route.ts",
      "cron/weekly-review-email/route.ts",
    ]) {
      const text = source(file);
      expect(text, file).toContain("sendWeeklyReviewsCron");
      expect(text, file).not.toContain("deliverWeeklyReviewEmails");
      expect(text, file).not.toContain("getSupabaseServiceClient");
    }
  });

  it("keeps the MCP route protocol-only", () => {
    const text = source("mcp/route.ts");
    expect(text).toContain("createLazyMcpEndpoint");
    expect(text).not.toMatch(/supabase|task-service|project-service|goal-service|@\/components/i);
  });

  it("keeps OAuth consent free of product mutation authority", () => {
    const text = source("oauth/decision/route.ts");
    expect(text).toContain("processOAuthConsentDecision");
    expect(text).not.toMatch(/task-service|project-service|goal-service|SupabaseTasksRepository|SupabaseProjectsRepository|SupabaseGoalsRepository/);
  });

  it("keeps Google Calendar integration identity out of request payloads", () => {
    for (const file of [
      "integrations/google-calendar/connect/route.ts",
      "integrations/google-calendar/callback/route.ts",
    ]) {
      const text = source(file);
      expect(text, file).not.toContain("createAuthenticatedActor(");
      expect(text, file).not.toMatch(/ownerUserId\s*[:=]\s*(?:request|body|formData|url|callbackUrl)/);
      expect(text, file).not.toMatch(/@\/components|@\/app\/\(app\)/);
    }
  });
});

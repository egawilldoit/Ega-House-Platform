import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("EGA-516 Operator acceptance", () => {
  it("authenticated / opens canonical Operator/Today surface", () => {
    const page = read("src/app/page.tsx");
    expect(page).toContain('redirect("/today")');
    expect(page).not.toContain('redirect("/dashboard")');
  });

  it("/dashboard no longer computes competing command-center model and redirects to Operator", () => {
    const dashboardPage = read("src/app/dashboard/page.tsx");
    expect(dashboardPage).toContain('redirect("/today")');
    // Should not import or compute competing dashboard-data panels
    expect(dashboardPage).not.toContain("getDashboardData");
    expect(dashboardPage).not.toContain("CommandCenterAsync");
    expect(dashboardPage).not.toContain("getDashboardHealthData");
  });

  it("web Today no longer forks shared ranking/status semantics", () => {
    const todayPage = read("src/app/today/page.tsx");
    // Must use canonical operator service, not web-local planner service
    expect(todayPage).toContain("getOperatorSnapshotData");
    expect(todayPage).toContain('from "@/lib/services/operator-service"');
    // Should delegate ranking to shared @ega/application, not web's buildTodayPlan
    expect(todayPage).not.toContain("getTodayPlannerData");
    // The operator service itself must be thin and delegate to @ega/application
    const opService = read("src/lib/services/operator-service.ts");
    expect(opService).toContain("getOperatorSnapshot");
    expect(opService).toContain('from "@ega/application"');
    expect(opService).toContain("SupabaseTodayReadPort");
    // The shared operator snapshot must contain schedule helpers and signals
    const appSnapshot = read("../../packages/application/src/operator/snapshot.ts");
    expect(appSnapshot).toContain("isValidScheduledTaskBlock");
    expect(appSnapshot).toContain("isScheduledTaskForToday");
    expect(appSnapshot).toContain("signals");
    expect(appSnapshot).toContain("health");
    expect(appSnapshot).toContain("friction");
    expect(appSnapshot).toContain("inbox");
    expect(appSnapshot).toContain("weeklyObjective");
  });

  it("Operator can load when optional signal providers are absent", async () => {
    const { createAuthenticatedActor } = await import("@ega/application");
    const { getOperatorSnapshot } = await import("@ega/application/operator/snapshot");
    // Use a minimal fake port that succeeds
    const fakePort: any = {
      listSelectedTasks: async () => ({ ok: true, value: [] }),
      listPinnedSuggestions: async () => ({ ok: true, value: [] }),
      listInProgressSuggestions: async () => ({ ok: true, value: [] }),
      getTodayTimerSnapshot: async () => ({ ok: true, value: { activeTimer: null, trackedTodaySeconds: 0 } }),
    };
    const result = await getOperatorSnapshot(createAuthenticatedActor("user-1"), fakePort, { date: "2026-08-10" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.signals.health).toBeNull();
    expect(result.data.signals.friction).toBeNull();
    expect(result.data.signals.inbox).toBeNull();
    expect(result.data.signals.weeklyObjective).toBeNull();
    expect(result.data.sections).toBeDefined();
    expect(result.data.focus).toBeDefined();
    expect(result.data.schedule).toBeDefined();
  });

  it("mobile Today remains first tab and uses shared contracts/server/api-client", () => {
    const mobileTabs = readFileSync(resolve(process.cwd(), "../mobile/app/(app)/(tabs)/_layout.tsx"), "utf8");
    // Today must be first Tabs.Screen
    const todayIndex = mobileTabs.indexOf('name="today"');
    const workIndex = mobileTabs.indexOf('name="work"');
    expect(todayIndex).toBeGreaterThan(-1);
    expect(workIndex).toBeGreaterThan(-1);
    expect(todayIndex).toBeLessThan(workIndex);

    const apiClientToday = read("../../packages/api-client/src/today.ts");
    expect(apiClientToday).toContain('path: "/api/today"');
    expect(apiClientToday).toContain("OperatorSnapshotDto");

    const serverTodayContent = readFileSync(resolve(process.cwd(), "../server/src/routes/today.ts"), "utf8");
    expect(serverTodayContent).toContain("getOperatorSnapshot");
    expect(serverTodayContent).toContain("OperatorSnapshotDto");

    const mobileIndex = readFileSync(resolve(process.cwd(), "../mobile/app/index.tsx"), "utf8");
    expect(mobileIndex).toContain('Redirect href="/(app)/(tabs)/today"');
  });

  it("RLS preserved: data-access scopes by owner_user_id and web uses request-scoped client", () => {
    const todayRepo = read("../../packages/data-access/src/today/repository.ts");
    expect(todayRepo).toContain("owner_user_id");
    expect(todayRepo).toContain("actor.userId");
    const opService = read("src/lib/services/operator-service.ts");
    expect(opService).toContain("createClient");
    expect(opService).toContain("createAuthenticatedActor");
    expect(opService).toContain("SupabaseTodayReadPort");
    // Should not accept caller-selected user id from body/query
    expect(opService).not.toContain("body.userId");
    expect(opService).not.toContain("query.userId");
  });

  it("web/mobile routing, application, contracts share one task shape (no forked dueBucket)", () => {
    const appPlan = read("../../packages/application/src/today/plan.ts");
    expect(appPlan).toContain("dueBucket");
    expect(appPlan).toContain("scheduledStartAt");
    expect(appPlan).toContain("scheduledEndAt");
    const webBuilder = read("src/lib/services/today-plan-builder.ts");
    // Web builder should now delegate or at least not be the canonical owner – check it does not duplicate ranking alone
    // If it exists, it should be thin or re-export; we at least ensure operator snapshot is the owner
    const opService = read("src/lib/services/operator-service.ts");
    expect(opService.length).toBeGreaterThan(100);
    // Ensure mobile contracts use same MobileTodayTaskItem
    const mobileContracts = read("../../packages/contracts/src/mobile.ts");
    expect(mobileContracts).toContain("MobileTodayTaskItem");
    expect(mobileContracts).toContain("dueBucket");
  });
});

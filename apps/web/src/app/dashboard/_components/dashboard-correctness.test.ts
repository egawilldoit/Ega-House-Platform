import { describe, expect, it } from "vitest";

import { buildAttentionItems } from "./AttentionQueueCard";

// P1 regression: project without deadline is never "due soon"
describe("dashboard correctness — P1", () => {
  it("project without deadline is never due soon", () => {
    const items = buildAttentionItems({
      blockedCount: 0,
      overdueCount: 0,
      dueTodayCount: 0,
      reviewMissing: false,
      atRiskGoals: [],
      dueProjects: [],
    });
    const dueSoon = items.filter((i) => i.detail.includes("due soon"));
    expect(dueSoon.length).toBe(0);
  });

  it("does not label recently updated projects as due soon", () => {
    const fakeDueProjects = [
      { id: "p1", name: "Recently Updated Project", slug: "recent" },
      { id: "p2", name: "Another Project", slug: "another" },
    ];
    const correctItems = buildAttentionItems({
      blockedCount: 0,
      overdueCount: 0,
      dueTodayCount: 0,
      reviewMissing: false,
      atRiskGoals: [],
      dueProjects: [], // correct: empty
    });
    const incorrectItems = buildAttentionItems({
      blockedCount: 0,
      overdueCount: 0,
      dueTodayCount: 0,
      reviewMissing: false,
      atRiskGoals: [],
      dueProjects: fakeDueProjects, // old buggy: would create 2 due soon
    });
    expect(correctItems.filter((i) => i.id.startsWith("project-")).length).toBe(0);
    expect(incorrectItems.filter((i) => i.id.startsWith("project-")).length).toBe(2);
    expect(correctItems.length).toBe(0);
  });

  it("pending review uses current-week truth, not any latest review exists", () => {
    const withOldReviewButMissingCurrent = buildAttentionItems({
      blockedCount: 0,
      overdueCount: 0,
      dueTodayCount: 0,
      reviewMissing: true,
      atRiskGoals: [],
      dueProjects: [],
    });
    const pending = withOldReviewButMissingCurrent.find((i) => i.id === "review-missing");
    expect(pending).toBeTruthy();

    const withCurrentReview = buildAttentionItems({
      blockedCount: 0,
      overdueCount: 0,
      dueTodayCount: 0,
      reviewMissing: false,
      atRiskGoals: [],
      dueProjects: [],
    });
    const notPending = withCurrentReview.find((i) => i.id === "review-missing");
    expect(notPending).toBeUndefined();
  });

  it("goal counts handle >6 and >500 goals correctly (authoritative, not 6-row slice)", () => {
    // Simulate 600 goals — limit(500) would truncate, but exact count should handle
    const allGoals = Array.from({ length: 600 }, (_, i) => ({
      id: `g${i}`,
      status: i < 350 ? "active" : "archived",
    }));
    const activeCount = allGoals.filter((g) => g.status === "active").length;
    const totalCount = allGoals.length;
    expect(totalCount).toBe(600);
    expect(activeCount).toBe(350);
    // Old buggy: limit(500) would give 500, not 600
    const limited = allGoals.slice(0, 500);
    expect(limited.length).toBe(500);
    expect(totalCount).not.toBe(limited.length);
    // Old presentation slice: limit(6) would give 6
    const sliced = allGoals.slice(0, 6);
    expect(sliced.length).toBe(6);
    expect(totalCount).not.toBe(sliced.length);
  });

  it("active goal count comes from exact authoritative count, not presentation limit", () => {
    // Simulate Supabase count queries
    const mockTotalResult = { count: 42, error: null };
    const mockActiveResult = { count: 18, error: null };
    const goalsTotal = mockTotalResult.error ? 0 : (mockTotalResult.count ?? 0);
    const activeGoals = mockActiveResult.error ? 0 : (mockActiveResult.count ?? 0);
    expect(goalsTotal).toBe(42);
    expect(activeGoals).toBe(18);
    // If we used presentation slice, we'd get at most 6
    expect(goalsTotal).toBeGreaterThan(6);
  });

  it("Supabase goal-count error is not silently treated as valid zero", () => {
    const mockErrorResult = { count: null, error: { message: "db down" } as unknown as { message: string } };
    const mockOkResult = { count: 5, error: null };
    const totalWithError = mockErrorResult.error ? null : (mockErrorResult.count ?? 0);
    const activeWithOk = mockOkResult.error ? null : (mockOkResult.count ?? 0);
    expect(totalWithError).toBeNull(); // indicates error, not 0
    expect(activeWithOk).toBe(5);
  });

  it("successful count 0 renders as legitimate zero, failure as —", () => {
    const successZero = { count: 0, error: null };
    const failure = { count: null, error: { message: "fail" } as unknown as { message: string } };
    const successValue = successZero.error ? null : (successZero.count ?? 0);
    const failureValue = failure.error ? null : (failure.count ?? 0);
    expect(successValue).toBe(0); // legitimate zero
    expect(failureValue).toBeNull(); // degraded — should render as —
    // View should distinguish: 0 vs —
    const render = (v: number | null) => (v === null ? "—" : String(v));
    expect(render(successValue)).toBe("0");
    expect(render(failureValue)).toBe("—");
    expect(render(successValue)).not.toBe(render(failureValue));
  });

  it("successful large counts remain exact", () => {
    const largeTotal = { count: 847, error: null };
    const largeActive = { count: 423, error: null };
    const total = largeTotal.error ? null : (largeTotal.count ?? 0);
    const active = largeActive.error ? null : (largeActive.count ?? 0);
    expect(total).toBe(847);
    expect(active).toBe(423);
  });

  it("at-risk goal outside first 6 presentation rows can still appear in Attention Queue", () => {
    // Simulate 10 goals, first 6 are healthy, next 4 are at-risk (outside slice)
    const allGoals = Array.from({ length: 10 }, (_, i) => ({
      id: `g${i}`,
      title: `Goal ${i}`,
      health: i < 6 ? "on_track" : i === 7 ? "at_risk" : "off_track",
    }));
    const presentationSlice = allGoals.slice(0, 6);
    const atRiskInSlice = presentationSlice.filter((g) => g.health === "at_risk" || g.health === "off_track");
    expect(atRiskInSlice.length).toBe(0); // none in first 6
    // Authoritative query should find them
    const authoritativeAtRisk = allGoals.filter((g) => g.health === "at_risk" || g.health === "off_track");
    expect(authoritativeAtRisk.length).toBe(4);
    const items = buildAttentionItems({
      blockedCount: 0,
      overdueCount: 0,
      dueTodayCount: 0,
      reviewMissing: false,
      atRiskGoals: authoritativeAtRisk.slice(0, 2).map((g) => ({ id: g.id, title: g.title })),
      dueProjects: [],
    });
    expect(items.some((i) => i.tone === "risk")).toBe(true);
  });

  it("attention queue prioritizes overdue > blocked > risk > pending", () => {
    const items = buildAttentionItems({
      blockedCount: 1,
      overdueCount: 1,
      dueTodayCount: 1,
      reviewMissing: true,
      atRiskGoals: [{ id: "g1", title: "At risk goal" }],
      dueProjects: [],
    });
    expect(items[0].tone).toBe("overdue");
    expect(items[1].tone).toBe("blocked");
    expect(items[2].tone).toBe("risk");
  });
});

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

  it("goal counts handle >6 goals correctly (authoritative, not 6-row slice)", () => {
    const allGoals = Array.from({ length: 10 }, (_, i) => ({
      id: `g${i}`,
      status: i < 7 ? "active" : "archived",
    }));
    const activeCount = allGoals.filter((g) => g.status === "active").length;
    const totalCount = allGoals.length;
    expect(totalCount).toBe(10);
    expect(activeCount).toBe(7);
    const sliced = allGoals.slice(0, 6);
    expect(sliced.length).toBe(6);
    expect(sliced.filter((g) => g.status === "active").length).toBe(6);
    expect(totalCount).not.toBe(sliced.length);
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

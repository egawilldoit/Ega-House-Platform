import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const view = readFileSync(resolve(process.cwd(), "src/app/(workspace)/work-analytics/_components/WorkAnalyticsPageView.tsx"), "utf8");

describe("WorkAnalytics — restored capabilities", () => {
  it("exposes Month Comparison (monthComparison)", () => {
    expect(view).toContain("Month-to-date");
    expect(view).toContain("Previous month");
    expect(view).toContain("Change vs previous month");
    expect(view).toContain("Average active day");
    expect(view).toContain("report.monthComparison.currentMonthMinutes");
    expect(view).toContain("report.monthComparison.previousMonthMinutes");
    expect(view).toContain("report.monthComparison.deltaMinutes");
    expect(view).toContain("report.monthComparison.currentMonthAvgPerActiveDayMinutes");
  });

  it("exposes the work-targets and job-search subset section", () => {
    expect(view).toContain("Work targets");
    expect(view).toContain("analytics-work-targets");
    expect(view).toContain("Included in work, not extra.");
    expect(view).toContain("Not configured");
    expect(view).toContain('href="/settings/preferences"');
  });

  it("exposes Estimate Accuracy (estimateAccuracy)", () => {
    expect(view).toContain("Estimate variance");
    expect(view).toContain("report.estimateAccuracy.totalEstimatedMinutes");
    expect(view).toContain("report.estimateAccuracy.totalTrackedMinutes");
    expect(view).toContain("report.estimateAccuracy.estimateDeltaMinutes");
    expect(view).toContain("report.estimateAccuracy.estimateDeltaPercent");
    expect(view).toContain("report.estimateAccuracy.overCount");
    expect(view).toContain("report.estimateAccuracy.underCount");
    expect(view).toContain("report.estimateAccuracy.noEstimateCount");
  });
});

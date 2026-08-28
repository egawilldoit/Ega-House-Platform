import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const view = readFileSync(resolve(process.cwd(), "src/app/work-analytics/_components/WorkAnalyticsPageView.tsx"), "utf8");

describe("WorkAnalytics — restored capabilities", () => {
  it("exposes Month Comparison (monthComparison)", () => {
    expect(view).toContain("Month-to-date");
    expect(view).toContain("Previous month");
    expect(view).toContain("MoM delta");
    expect(view).toContain("Avg active day");
    expect(view).toContain("report.monthComparison.currentMonthMinutes");
    expect(view).toContain("report.monthComparison.previousMonthMinutes");
    expect(view).toContain("report.monthComparison.deltaMinutes");
    expect(view).toContain("report.monthComparison.currentMonthAvgPerActiveDayMinutes");
  });

  it("exposes Estimate Accuracy (estimateAccuracy)", () => {
    expect(view).toContain("Estimate accuracy");
    expect(view).toContain("report.estimateAccuracy.totalEstimatedMinutes");
    expect(view).toContain("report.estimateAccuracy.totalTrackedMinutes");
    expect(view).toContain("report.estimateAccuracy.estimateDeltaMinutes");
    expect(view).toContain("report.estimateAccuracy.estimateDeltaPercent");
    expect(view).toContain("report.estimateAccuracy.overCount");
    expect(view).toContain("report.estimateAccuracy.underCount");
    expect(view).toContain("report.estimateAccuracy.noEstimateCount");
  });
});

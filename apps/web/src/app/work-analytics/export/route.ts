import { createClient } from "@/lib/supabase/server";
import { captureServerException } from "@/lib/monitoring/capture-server-exception";
import {
  getWorkAnalyticsSessionsForWindow,
} from "@/lib/services/work-analytics-data-adapter";
import {
  calculateWorkAnalytics,
  calculateWorkAnalyticsDailySeries,
  calculateWorkAnalyticsProjectBreakdown,
  calculateWorkAnalyticsGoalBreakdown,
  calculateWorkAnalyticsTaskBreakdown,
  calculateWorkAnalyticsInsights,
  extractSessionDurationsInWindow,
  calculateSessionQuality,
  type WorkAnalyticsDaily,
  type WorkAnalyticsProjectBreakdown,
  type WorkAnalyticsGoalBreakdown,
  type WorkAnalyticsTaskBreakdown,
  type WorkAnalyticsInsights,
} from "@/lib/services/work-analytics-service";
import type { ExecutionEvidenceWindow } from "@/lib/services/execution-evidence-service";

// Re-exported types from work-analytics-service for local use
type EstimateAccuracyTask = {
  taskId: string;
  taskTitle: string;
  projectName: string | null;
  estimateMinutes: number | null;
  trackedMinutes: number;
  sessionCount: number;
  deltaMinutes: number | null;
  percentError: number | null;
  status: "over" | "under" | "exact" | "no-estimate";
};

type EstimateAccuracySummary = {
  totalEstimatedMinutes: number;
  totalTrackedMinutes: number;
  estimateDeltaMinutes: number;
  estimateDeltaPercent: number | null;
  overEstimatedCount: number;
  underEstimatedCount: number;
  exactCount: number;
  noEstimateCount: number;
  tasks: EstimateAccuracyTask[];
  projectAccuracy: { projectName: string; totalEstimated: number; totalTracked: number }[];
};

export const dynamic = "force-dynamic";

/**
 * Build a calendar-month window (UTC) from a YYYY-MM string.
 * Returns null if the input is invalid.
 */
export function buildMonthWindow(monthParam: string): {
  window: ExecutionEvidenceWindow;
  monthLabel: string;
} | null {
  const match = monthParam.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10) - 1; // 0-indexed

  if (month < 0 || month > 11) return null;

  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));

  return {
    window: { startIso: start.toISOString(), endIso: end.toISOString() },
    monthLabel: start.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      timeZone: "UTC",
    }),
  };
}

/**
 * Get the current calendar-month window (UTC).
 */
export function getCurrentMonthWindow(): {
  window: ExecutionEvidenceWindow;
  monthLabel: string;
} {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return {
    window: { startIso: start.toISOString(), endIso: end.toISOString() },
    monthLabel: start.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      timeZone: "UTC",
    }),
  };
}

/**
 * Format minutes as a human-readable duration string.
 */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return "0m";
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (hours === 0) return `${remaining}m`;
  if (remaining === 0) return `${hours}h`;
  return `${hours}h ${remaining}m`;
}

/**
 * Build the estimate accuracy summary from tasks.
 */
export function buildEstimateAccuracySummary(
  breakdown: WorkAnalyticsTaskBreakdown[],
): EstimateAccuracySummary {
  let totalEstimatedMinutes = 0;
  let totalTrackedMinutes = 0;
  let overEstimatedCount = 0;
  let underEstimatedCount = 0;
  let exactCount = 0;
  let noEstimateCount = 0;

  for (const task of breakdown) {
    totalTrackedMinutes += task.workedMinutes;

    if (task.estimateMinutes == null) {
      noEstimateCount++;
    } else {
      totalEstimatedMinutes += task.estimateMinutes;
      const delta = task.workedMinutes - task.estimateMinutes;
      if (delta === 0) {
        exactCount++;
      } else if (delta < 0) {
        overEstimatedCount++;
      } else {
        underEstimatedCount++;
      }
    }
  }

  const estimateDeltaMinutes = totalTrackedMinutes - totalEstimatedMinutes;
  const estimateDeltaPercent =
    totalEstimatedMinutes > 0
      ? Math.round((estimateDeltaMinutes / totalEstimatedMinutes) * 100)
      : null;

  return {
    totalEstimatedMinutes,
    totalTrackedMinutes,
    estimateDeltaMinutes,
    estimateDeltaPercent,
    overEstimatedCount,
    underEstimatedCount,
    exactCount,
    noEstimateCount,
    tasks: breakdown.map((t) => ({
      taskId: t.taskId,
      taskTitle: t.taskTitle,
      projectName: t.projectName,
      estimateMinutes: t.estimateMinutes,
      trackedMinutes: t.workedMinutes,
      sessionCount: t.sessionCount,
      deltaMinutes:
        t.estimateMinutes != null
          ? t.workedMinutes - t.estimateMinutes
          : null,
      percentError:
        t.estimateMinutes != null && t.estimateMinutes > 0
          ? Math.round(
              ((t.workedMinutes - t.estimateMinutes) / t.estimateMinutes) *
                100,
            )
          : null,
      status:
        t.estimateMinutes == null
          ? ("no-estimate" as const)
          : t.workedMinutes === t.estimateMinutes
            ? ("exact" as const)
            : t.workedMinutes < t.estimateMinutes
              ? ("over" as const)
              : ("under" as const),
    })),
    projectAccuracy: [],
  };
}

/**
 * Generate a monthly analytics Markdown report.
 */
export function buildMonthlyMarkdown({
  monthLabel,
  window,
  period,
  dailySeries,
  sessionQuality,
  activeDays,
  projectBreakdown,
  goalBreakdown,
  taskBreakdown,
  insights,
  estimateAccuracy,
  timezoneInfo,
}: {
  monthLabel: string;
  window: ExecutionEvidenceWindow;
  period: { totalWorkedMinutes: number; sessionCount: number };
  dailySeries: WorkAnalyticsDaily[];
  sessionQuality: ReturnType<typeof calculateSessionQuality>;
  activeDays: number;
  projectBreakdown: WorkAnalyticsProjectBreakdown[];
  goalBreakdown: WorkAnalyticsGoalBreakdown[];
  taskBreakdown: WorkAnalyticsTaskBreakdown[];
  insights: WorkAnalyticsInsights;
  estimateAccuracy: EstimateAccuracySummary;
  timezoneInfo: {
    ianaName: string;
    offsetMinutes: number;
  };
}): string {
  const lines: string[] = [];

  // Title and metadata
  lines.push(`# Monthly Analytics: ${monthLabel}`);
  lines.push("");
  lines.push(`- **Period:** ${window.startIso.slice(0, 10)} → ${window.endIso.slice(0, 10)}`);
  lines.push(`- **Generated:** ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`);
  lines.push(`- **Timezone:** ${timezoneInfo.ianaName} (UTC${timezoneInfo.offsetMinutes >= 0 ? "+" : ""}${Math.floor(timezoneInfo.offsetMinutes / 60)}:${String(Math.abs(timezoneInfo.offsetMinutes) % 60).padStart(2, "0")})`);
  lines.push("");

  // === Summary ===
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total worked time | ${formatDuration(period.totalWorkedMinutes)} |`);
  lines.push(`| Active days | ${activeDays} / ${dailySeries.length} |`);
  lines.push(`| Total sessions | ${period.sessionCount} |`);
  lines.push(
    `| Avg work / active day | ${formatDuration(activeDays > 0 ? Math.round(period.totalWorkedMinutes / activeDays) : 0)} |`,
  );
  lines.push(
    `| Avg session length | ${formatDuration(sessionQuality.averageSessionLengthMinutes)} |`,
  );
  lines.push(
    `| Median session length | ${formatDuration(Math.round(sessionQuality.medianSessionLengthMinutes))} |`,
  );
  lines.push(`| Longest session | ${formatDuration(sessionQuality.longestSessionMinutes)} |`);
  lines.push(`| Current streak | ${insights.currentStreak} days |`);
  lines.push("");

  // === Comparison with previous period ===
  lines.push("## Comparison with Previous Period");
  lines.push("");
  if (insights.percentChange !== null) {
    const direction =
      insights.deltaMinutes > 0
        ? "↑"
        : insights.deltaMinutes < 0
          ? "↓"
          : "→";
    lines.push(
      `- **${formatDuration(Math.abs(insights.deltaMinutes))}** ${direction} (${insights.percentChange >= 0 ? "+" : ""}${insights.percentChange}%) vs previous period`,
    );
  } else {
    lines.push("- No previous period data for comparison.");
  }
  lines.push(`- Previous period: ${formatDuration(insights.previousPeriodWorkedMinutes)}`);
  lines.push(`- Current period: ${formatDuration(period.totalWorkedMinutes)}`);
  lines.push("");

  // === Session Quality ===
  lines.push("## Session Quality");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Average session | ${formatDuration(sessionQuality.averageSessionLengthMinutes)} |`);
  lines.push(`| Median session | ${formatDuration(Math.round(sessionQuality.medianSessionLengthMinutes))} |`);
  lines.push(`| Longest session | ${formatDuration(sessionQuality.longestSessionMinutes)} |`);
  lines.push(`| Sessions < 5 min | ${sessionQuality.sessionsUnder5Min} |`);
  lines.push(`| Sessions < 15 min | ${sessionQuality.sessionsUnder15Min} |`);
  lines.push(`| Sessions > 90 min | ${sessionQuality.sessionsOver90Min} |`);
  lines.push(`| Sessions > 180 min | ${sessionQuality.sessionsOver180Min} |`);
  lines.push("");

  // === Problem Signals ===
  lines.push("## Problem Signals");
  lines.push("");
  const problems: string[] = [];

  if (sessionQuality.sessionsUnder5Min > sessionQuality.totalSessions * 0.3) {
    problems.push(
      `- ⚠️ **Excessive short sessions:** ${sessionQuality.sessionsUnder5Min} sessions under 5 min (${Math.round((sessionQuality.sessionsUnder5Min / sessionQuality.totalSessions) * 100)}% of all sessions) — possible context switching`,
    );
  }
  if (activeDays > 0 && activeDays < dailySeries.length * 0.4) {
    problems.push(
      `- ⚠️ **Low active days:** Only ${activeDays} out of ${dailySeries.length} days had tracked work`,
    );
  }
  if (insights.deltaMinutes < 0 && insights.percentChange !== null && insights.percentChange < -20) {
    problems.push(
      `- ⚠️ **Significant decline:** ${insights.deltaMinutes >= 0 ? "+" : ""}${insights.deltaMinutes} min (${insights.percentChange}%) vs previous period`,
    );
  }
  if (sessionQuality.sessionsOver180Min > 3) {
    problems.push(
      `- ⚠️ **Very long sessions:** ${sessionQuality.sessionsOver180Min} sessions exceeded 3 hours — possible burnout risk`,
    );
  }
  if (estimateAccuracy.noEstimateCount > estimateAccuracy.tasks.length * 0.5) {
    problems.push(
      `- ℹ️ **Low estimation rate:** ${estimateAccuracy.noEstimateCount} of ${estimateAccuracy.tasks.length} tracked tasks had no time estimate`,
    );
  }
  if (estimateAccuracy.underEstimatedCount > estimateAccuracy.tasks.length * 0.4) {
    problems.push(
      `- ⚠️ **Under-estimation trend:** ${estimateAccuracy.underEstimatedCount} tasks exceeded their estimates`,
    );
  }

  if (problems.length === 0) {
    lines.push("No significant issues detected this month. ✅");
  } else {
    lines.push(...problems);
  }
  lines.push("");

  // === Top Projects ===
  lines.push("## Top Projects");
  lines.push("");
  if (projectBreakdown.length === 0) {
    lines.push("No project data available.");
  } else {
    lines.push("| # | Project | Worked Time | Sessions | % of Total |");
    lines.push("|---|---------|-------------|----------|-----------|");
    const totalMinutes = projectBreakdown.reduce(
      (s, p) => s + p.workedMinutes,
      0,
    );
    projectBreakdown.slice(0, 10).forEach((p, i) => {
      const pct =
        totalMinutes > 0
          ? Math.round((p.workedMinutes / totalMinutes) * 100)
          : 0;
      lines.push(
        `| ${i + 1} | ${p.projectName} | ${formatDuration(p.workedMinutes)} | ${p.sessionCount} | ${pct}% |`,
      );
    });
  }
  lines.push("");

  // === Top Goals ===
  lines.push("## Top Goals");
  lines.push("");
  if (goalBreakdown.length === 0) {
    lines.push("No goal data available.");
  } else {
    lines.push("| # | Goal | Project | Worked Time | Sessions |");
    lines.push("|---|------|---------|-------------|----------|");
    goalBreakdown.slice(0, 10).forEach((g, i) => {
      lines.push(
        `| ${i + 1} | ${g.goalTitle} | ${g.projectName} | ${formatDuration(g.workedMinutes)} | ${g.sessionCount} |`,
      );
    });
  }
  lines.push("");

  // === Top Tasks ===
  lines.push("## Top Tasks");
  lines.push("");
  if (taskBreakdown.length === 0) {
    lines.push("No task data available.");
  } else {
    lines.push("| # | Task | Project | Worked Time | Sessions | % |");
    lines.push("|---|------|---------|-------------|----------|---|");
    taskBreakdown.slice(0, 10).forEach((t, i) => {
      lines.push(
        `| ${i + 1} | ${t.taskTitle} | ${t.projectName ?? "—"} | ${formatDuration(t.workedMinutes)} | ${t.sessionCount} | ${t.percentOfTotal}% |`,
      );
    });
  }
  lines.push("");

  // === Estimate Accuracy ===
  lines.push("## Estimate Accuracy");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total estimated | ${formatDuration(estimateAccuracy.totalEstimatedMinutes)} |`);
  lines.push(`| Total tracked | ${formatDuration(estimateAccuracy.totalTrackedMinutes)} |`);
  lines.push(`| Delta | ${estimateAccuracy.estimateDeltaMinutes >= 0 ? "+" : ""}${formatDuration(Math.abs(estimateAccuracy.estimateDeltaMinutes))} |`);
  lines.push(
    `| Delta % | ${estimateAccuracy.estimateDeltaPercent !== null ? (estimateAccuracy.estimateDeltaPercent >= 0 ? "+" : "") + `${estimateAccuracy.estimateDeltaPercent}%` : "N/A"} |`,
  );
  lines.push(`| Over-estimated (task took less) | ${estimateAccuracy.overEstimatedCount} |`);
  lines.push(`| Under-estimated (task took more) | ${estimateAccuracy.underEstimatedCount} |`);
  lines.push(`| Exact matches | ${estimateAccuracy.exactCount} |`);
  lines.push(`| No estimate | ${estimateAccuracy.noEstimateCount} |`);
  lines.push("");

  // === Daily Breakdown ===
  lines.push("## Daily Breakdown");
  lines.push("");
  if (dailySeries.length === 0) {
    lines.push("No daily data available.");
  } else {
    lines.push("| Date | Worked Time | Sessions | Active |");
    lines.push("|------|-------------|----------|--------|");
    for (const day of dailySeries) {
      lines.push(
        `| ${day.date} | ${day.workedMinutes > 0 ? formatDuration(day.workedMinutes) : "—"} | ${day.sessionCount > 0 ? day.sessionCount : "—"} | ${day.workedMinutes > 0 ? "✅" : "—"} |`,
      );
    }
  }
  lines.push("");

  // === Timezone Metadata ===
  lines.push("## Timezone Metadata");
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| IANA Timezone | ${timezoneInfo.ianaName} |`);
  lines.push(`| UTC Offset | UTC${timezoneInfo.offsetMinutes >= 0 ? "+" : ""}${Math.floor(timezoneInfo.offsetMinutes / 60)}:${String(Math.abs(timezoneInfo.offsetMinutes) % 60).padStart(2, "0")} |`);
  lines.push(`| Offset Minutes | ${timezoneInfo.offsetMinutes} |`);
  lines.push("");

  return lines.join("\n");
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const monthParam = url.searchParams.get("month");

    // Resolve month window
    let windowData: { window: ExecutionEvidenceWindow; monthLabel: string };

    if (monthParam) {
      const parsed = buildMonthWindow(monthParam);
      if (!parsed) {
        return Response.json(
          {
            error:
              'Invalid month format. Use YYYY-MM (e.g., ?month=2026-06).',
          },
          { status: 400 },
        );
      }
      windowData = parsed;
    } else {
      windowData = getCurrentMonthWindow();
    }

    const { window: monthWindow, monthLabel } = windowData;

    // Authenticate and get user
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }

    const ownerUserId = user.id;

    // Load sessions for the month window
    const sessionsResult = await getWorkAnalyticsSessionsForWindow({
      ownerUserId,
      supabase,
      window: monthWindow,
    });

    if (sessionsResult.errorMessage || !sessionsResult.data) {
      return Response.json(
        { error: sessionsResult.errorMessage ?? "Failed to load session data." },
        { status: 500 },
      );
    }

    const sessions = sessionsResult.data;

    // If no sessions, return an empty report gracefully
    if (sessions.length === 0) {
      const timezoneInfo = {
        ianaName:
          Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        offsetMinutes: -new Date().getTimezoneOffset(),
      };

      const emptyReport = buildMonthlyMarkdown({
        monthLabel,
        window: monthWindow,
        period: { totalWorkedMinutes: 0, sessionCount: 0 },
        dailySeries: [],
        sessionQuality: {
          averageSessionLengthMinutes: 0,
          medianSessionLengthMinutes: 0,
          longestSessionMinutes: 0,
          sessionsUnder5Min: 0,
          sessionsUnder15Min: 0,
          sessionsOver90Min: 0,
          sessionsOver180Min: 0,
          totalSessions: 0,
        },
        activeDays: 0,
        projectBreakdown: [],
        goalBreakdown: [],
        taskBreakdown: [],
        insights: {
          previousPeriodWorkedMinutes: 0,
          deltaMinutes: 0,
          percentChange: null,
          bestDay: null,
          lowestNonZeroDay: null,
          daysWorkedCount: 0,
          currentStreak: 0,
          averageSessionLength: 0,
          longestSession: 0,
          shortestNonZeroSession: null,
        },
        estimateAccuracy: {
          totalEstimatedMinutes: 0,
          totalTrackedMinutes: 0,
          estimateDeltaMinutes: 0,
          estimateDeltaPercent: null,
          overEstimatedCount: 0,
          underEstimatedCount: 0,
          exactCount: 0,
          noEstimateCount: 0,
          tasks: [],
          projectAccuracy: [],
        },
        timezoneInfo,
      });

      const filename = `analytics-${monthParam ?? new Date().toISOString().slice(0, 7)}.md`;

      return new Response(emptyReport, {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="${filename}"`,
          "cache-control": "no-store",
        },
      });
    }

    // Compute all analytics
    const period = calculateWorkAnalytics(sessions, monthWindow);

    // Daily series for the month
    const startDateStr = monthWindow.startIso.slice(0, 10);
    const endDateStr = monthWindow.endIso.slice(0, 10);
    const dailySeries = calculateWorkAnalyticsDailySeries(
      sessions,
      startDateStr,
      endDateStr,
    );
    const activeDays = dailySeries.filter((d) => d.workedMinutes > 0).length;

    // Session quality
    const durations = extractSessionDurationsInWindow(sessions, monthWindow);
    const sessionQuality = calculateSessionQuality(durations);

    // Breakdowns
    const projectBreakdown = calculateWorkAnalyticsProjectBreakdown(
      sessions,
      monthWindow,
    );

    const goalBreakdown = calculateWorkAnalyticsGoalBreakdown(
      sessions,
      monthWindow,
    );

    const taskBreakdown = calculateWorkAnalyticsTaskBreakdown(
      sessions,
      monthWindow,
    );

    // Insights (comparison, streaks, etc.)
    const insights = calculateWorkAnalyticsInsights(sessions, monthWindow);

    // Estimate accuracy from task breakdown
    const estimateAccuracy = buildEstimateAccuracySummary(taskBreakdown);

    // Timezone metadata
    const timezoneInfo = {
      ianaName: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      offsetMinutes: -new Date().getTimezoneOffset(),
    };

    // Build markdown
    const markdown = buildMonthlyMarkdown({
      monthLabel,
      window: monthWindow,
      period,
      dailySeries,
      sessionQuality,
      activeDays,
      projectBreakdown,
      goalBreakdown,
      taskBreakdown,
      insights,
      estimateAccuracy,
      timezoneInfo,
    });

    const filename = `analytics-${monthParam ?? new Date().toISOString().slice(0, 7)}.md`;

    return new Response(markdown, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    captureServerException(err instanceof Error ? err : new Error(String(err)), {
      area: "route.work-analytics-export",
      operation: "generate_monthly_markdown",
    });
    return Response.json(
      { error: "Unable to generate monthly analytics report right now." },
      { status: 500 },
    );
  }
}

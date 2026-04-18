import { getWeekWindow, isIsoDate } from "@/lib/review-week";
import { getTaskSessionDurationSeconds } from "@/lib/task-session";
import { toCsvDocument } from "@/lib/csv";

type ReviewExportRecord = {
  id: string;
  week_start: string;
  week_end: string;
  summary: string | null;
  wins: string | null;
  blockers: string | null;
  next_steps: string | null;
  created_at: string;
  updated_at: string;
};

type ReviewExportStatSources = {
  taskCount: number;
  sessionRows: Array<{
    task_id: string;
    started_at: string;
    ended_at: string | null;
    duration_seconds: number | null;
  }>;
  goalStatuses: string[];
};

export function getReviewExportWeekOf(searchParams: URLSearchParams) {
  const weekOf = searchParams.get("weekOf")?.trim();
  if (!weekOf) {
    return null;
  }

  return isIsoDate(weekOf) ? weekOf : null;
}

export function buildReviewExportCsv(args: {
  reviews: ReviewExportRecord[];
  statSourcesByWeek?: Record<string, ReviewExportStatSources>;
  nowIso?: string;
}) {
  const nowIso = args.nowIso ?? new Date().toISOString();

  return toCsvDocument(
    [
      "review_id",
      "week_start",
      "week_end",
      "summary",
      "wins",
      "blockers",
      "next_steps",
      "tasks_created",
      "sessions_logged",
      "tracked_seconds",
      "goals_touched",
      "paused_or_draft_goals",
      "created_at",
      "updated_at",
    ],
    args.reviews.map((review) => {
      const stats = args.statSourcesByWeek?.[review.week_start];
      const trackedSeconds = (stats?.sessionRows ?? []).reduce(
        (sum, session) => sum + getTaskSessionDurationSeconds(session, nowIso),
        0,
      );
      const pausedOrDraftGoals = (stats?.goalStatuses ?? []).filter((status) =>
        ["paused", "draft"].includes(status),
      ).length;

      return [
        review.id,
        review.week_start,
        review.week_end,
        review.summary,
        review.wins,
        review.blockers,
        review.next_steps,
        stats?.taskCount ?? "",
        stats?.sessionRows.length ?? "",
        stats ? trackedSeconds : "",
        stats?.goalStatuses.length ?? "",
        stats ? pausedOrDraftGoals : "",
        review.created_at,
        review.updated_at,
      ];
    }),
  );
}

export function getReviewExportWindow(weekStart: string, weekEnd: string) {
  return getWeekWindow(weekStart, weekEnd);
}

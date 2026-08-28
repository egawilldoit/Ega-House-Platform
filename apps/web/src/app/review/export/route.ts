import { createClient } from "@/lib/supabase/server";
import { getWeekBoundsForTimezone } from "@/lib/review-week";
import {
  buildReviewExportCsv,
  getReviewExportWeekOf,
  getReviewExportWindow,
} from "@/lib/review-export";
import { captureServerException } from "@/lib/monitoring/capture-server-exception";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const selectedWeekOf = getReviewExportWeekOf(url.searchParams);
  const supabase = await createClient();

  let reviewQuery = supabase
    .from("week_reviews")
    .select("id, week_start, week_end, summary, wins, blockers, next_steps, created_at, updated_at")
    .order("week_start", { ascending: false });

  if (selectedWeekOf) {
    // Timezone-aware bounds via canonical Time Context
    let bounds: { weekStart: string; weekEnd: string } | null = null;
    try {
      const { data: authData } = await supabase.auth.getUser();
      const uid = authData.user?.id;
      let tz: string | null = null;
      if (uid) {
        const { data: tzRow } = await (supabase as unknown as { from: (t: string) => { select: (c: string) => { eq: (a: string, b: string) => { maybeSingle: () => Promise<{ data: { iana_timezone?: string | null } | null }> } } } }).from(
          "user_time_context",
        )
          .select("iana_timezone")
          .eq("user_id", uid)
          .maybeSingle();
        tz = (tzRow as { iana_timezone?: string | null } | null)?.iana_timezone ?? null;
      }
      bounds = getWeekBoundsForTimezone(selectedWeekOf, tz);
    } catch {
      bounds = getWeekBoundsForTimezone(selectedWeekOf, null);
    }

    if (!bounds) {
      return Response.json({ error: "Week selection is invalid." }, { status: 400 });
    }

    reviewQuery = reviewQuery
      .eq("week_start", bounds.weekStart)
      .eq("week_end", bounds.weekEnd);
  }

  const { data: reviews, error: reviewsError } = await reviewQuery;

  if (reviewsError) {
    captureServerException(reviewsError, {
      area: "route.review-export",
      operation: "load_reviews",
      extras: {
        selectedWeekOf,
      },
    });
    return Response.json({ error: "Unable to export review data right now." }, { status: 500 });
  }

  const statSourcesByWeek: Record<
    string,
    {
      taskCount: number;
      sessionRows: Array<{
        task_id: string;
        started_at: string;
        ended_at: string | null;
        duration_seconds: number | null;
      }>;
      goalStatuses: string[];
    }
  > = {};

  if (selectedWeekOf && (reviews?.length ?? 0) > 0) {
    const review = reviews![0];
    const window = getReviewExportWindow(review.week_start, review.week_end);
    const [tasksResult, sessionsResult, goalsResult] = await Promise.all([
      supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .gte("created_at", window.startIso)
        .lt("created_at", window.endExclusiveIso),
      supabase
        .from("task_sessions")
        .select("task_id, started_at, ended_at, duration_seconds")
        .gte("started_at", window.startIso)
        .lt("started_at", window.endExclusiveIso),
      supabase
        .from("goals")
        .select("status")
        .gte("updated_at", window.startIso)
        .lt("updated_at", window.endExclusiveIso),
    ]);

    if (tasksResult.error || sessionsResult.error || goalsResult.error) {
      captureServerException(tasksResult.error ?? sessionsResult.error ?? goalsResult.error, {
        area: "route.review-export",
        operation: "load_review_stats",
        extras: {
          selectedWeekOf,
        },
      });
      return Response.json({ error: "Unable to export review stats right now." }, { status: 500 });
    }

    statSourcesByWeek[review.week_start] = {
      taskCount: tasksResult.count ?? 0,
      sessionRows: sessionsResult.data ?? [],
      goalStatuses: (goalsResult.data ?? []).map((goal) => goal.status),
    };
  }

  const csv = buildReviewExportCsv({ reviews: reviews ?? [], statSourcesByWeek });
  const filename = selectedWeekOf ? `review-${selectedWeekOf}.csv` : "reviews.csv";

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

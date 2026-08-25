import { createClient } from "@/lib/supabase/server";
import { getWeeklyReviewPageData } from "@/lib/services/weekly-review-page-service";
import { formatIsoDate, getTodayIsoDate, isIsoDate, shiftIsoDateByDays } from "@/lib/review-week";

export type ReviewSearchParams = { draft?: string; weekOf?: string };

export async function getReviewPageModel(searchParams: ReviewSearchParams) {
  const supabase = await createClient();
  const weekOf = typeof searchParams.weekOf === "string" && isIsoDate(searchParams.weekOf) ? searchParams.weekOf : getTodayIsoDate();
  const data = await getWeeklyReviewPageData(supabase, weekOf);
  return { weekOf, data, supabase };
}

export type ReviewPageModel = Awaited<ReturnType<typeof getReviewPageModel>>;

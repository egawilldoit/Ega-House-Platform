import { createClient } from "@/lib/supabase/server";
import { getWeeklyReviewPageData } from "@/lib/services/weekly-review-page-service";
import { getTodayIsoDate, isIsoDate } from "@/lib/review-week";

export type ReviewSearchParams = { draft?: string; weekOf?: string };

export async function getReviewPageModel(searchParams: ReviewSearchParams) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  const ownerUserId = authData.user?.id ?? "";
  const selectedWeekOf = typeof searchParams.weekOf === "string" && isIsoDate(searchParams.weekOf) ? searchParams.weekOf : getTodayIsoDate();
  const useGeneratedDraft = searchParams.draft === "generated";
  const data = await getWeeklyReviewPageData({ ownerUserId, selectedWeekOf, useGeneratedDraft });
  return { weekOf: selectedWeekOf, data, supabase };
}

export type ReviewPageModel = Awaited<ReturnType<typeof getReviewPageModel>>;

import { createClient } from "@/lib/supabase/server";
import { getWeeklyReviewPageData } from "@/lib/services/weekly-review-page-service";
import { getTodayIsoDate, getTodayIsoDateForTimezone, isIsoDate } from "@/lib/review-week";
import { getWebTimeContext } from "@/lib/services/time-context-service";

export type ReviewSearchParams = { draft?: string; weekOf?: string };

export async function getReviewPageModel(searchParams: ReviewSearchParams) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  const ownerUserId = authData.user?.id ?? "";
  let todayIsoForSelection: string;
  try {
    if (ownerUserId) {
      const timeContext = await getWebTimeContext();
      todayIsoForSelection = getTodayIsoDateForTimezone(
        timeContext.persistedTimezone,
        new Date(),
      );
    } else {
      todayIsoForSelection = getTodayIsoDate();
    }
  } catch {
    todayIsoForSelection = getTodayIsoDate();
  }
  const selectedWeekOf =
    typeof searchParams.weekOf === "string" && isIsoDate(searchParams.weekOf) ? searchParams.weekOf : todayIsoForSelection;
  const useGeneratedDraft = searchParams.draft === "generated";
  const data = await getWeeklyReviewPageData({ ownerUserId, selectedWeekOf, useGeneratedDraft });
  return { weekOf: selectedWeekOf, data, supabase };
}

export type ReviewPageModel = Awaited<ReturnType<typeof getReviewPageModel>>;

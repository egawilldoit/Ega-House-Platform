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
  let timezone = "UTC";
  try {
    if (ownerUserId) {
      const timeContext = await getWebTimeContext();
      // Week selection keeps using the raw persisted value's existing
      // fallback semantics; display uses the validated effective zone.
      todayIsoForSelection = getTodayIsoDateForTimezone(
        timeContext.persistedTimezone,
        new Date(),
      );
      timezone = timeContext.timezone;
    } else {
      todayIsoForSelection = getTodayIsoDate();
    }
  } catch {
    todayIsoForSelection = getTodayIsoDate();
    timezone = "UTC";
  }
  const selectedWeekOf =
    typeof searchParams.weekOf === "string" && isIsoDate(searchParams.weekOf) ? searchParams.weekOf : todayIsoForSelection;
  const useGeneratedDraft = searchParams.draft === "generated";
  const data = await getWeeklyReviewPageData({ ownerUserId, selectedWeekOf, useGeneratedDraft });
  return { weekOf: selectedWeekOf, data, supabase, timezone };
}

export type ReviewPageModel = Awaited<ReturnType<typeof getReviewPageModel>>;

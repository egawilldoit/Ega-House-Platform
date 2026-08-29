import { createClient } from "@/lib/supabase/server";
import { getWeeklyReviewPageData } from "@/lib/services/weekly-review-page-service";
import { getTodayIsoDate, getTodayIsoDateForTimezone, isIsoDate } from "@/lib/review-week";

export type ReviewSearchParams = { draft?: string; weekOf?: string };

export async function getReviewPageModel(searchParams: ReviewSearchParams) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  const ownerUserId = authData.user?.id ?? "";
  let todayIsoForSelection: string;
  try {
    if (ownerUserId) {
      const { data: tzRow } = await (
        supabase as unknown as {
          from: (t: string) => {
            select: (c: string) => {
              eq: (a: string, b: string) => {
                maybeSingle: () => Promise<{ data: { iana_timezone?: string | null } | null }>;
              };
            };
          };
        }
      )
        .from("user_time_context")
        .select("iana_timezone")
        .eq("user_id", ownerUserId)
        .maybeSingle();
      const tz = (tzRow as { iana_timezone?: string | null } | null)?.iana_timezone;
      todayIsoForSelection = getTodayIsoDateForTimezone(typeof tz === "string" ? tz : null, new Date());
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

import { useQuery } from "@tanstack/react-query";

import { fetchMobileWeeklyReview } from "@/lib/api/weekly-review";

export const weeklyReviewQueryKeys = {
  all: ["weekly-review"] as const,
  detail: (weekOf?: string) => ["weekly-review", weekOf ?? "current"] as const,
};

export function useWeeklyReviewQuery(weekOf?: string) {
  return useQuery({
    queryKey: weeklyReviewQueryKeys.detail(weekOf),
    queryFn: () => fetchMobileWeeklyReview(weekOf),
    placeholderData: (previousData) => previousData,
  });
}

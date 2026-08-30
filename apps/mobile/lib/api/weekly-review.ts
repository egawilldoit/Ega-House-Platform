/**
 * Mobile Weekly Review API — typed wrapper over the @ega/api-client weekly-review surface
 * (canonical Hono transport), bound to the mobile session token.
 *
 * GET /api/review[?weekOf=YYYY-MM-DD] -> GetWeeklyReviewResponse
 */

import type { GetWeeklyReviewResponse } from "@ega/contracts/weekly-review";
import { getMobileEgaApiClient, unwrapApiResult } from "@/lib/api/ega";

export async function fetchMobileWeeklyReview(weekOf?: string): Promise<GetWeeklyReviewResponse> {
  return unwrapApiResult(await getMobileEgaApiClient().weeklyReview.get(weekOf));
}

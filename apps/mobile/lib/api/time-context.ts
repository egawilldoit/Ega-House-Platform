/**
 * Mobile Time Context API — typed wrapper over the @ega/api-client
 * timeContext surface (canonical GET /api/time-context), bound to the
 * mobile session token.
 *
 *   GET /api/time-context[?timezone][&date] -> GetTimeContextResponse
 *
 * Same owner/timezone/date yields identical web/mobile semantics (DST,
 * midnight adjacency, Asia/Tokyo, server-TZ invariance, historical
 * reproducibility, invalid IANA fallback) because both transports share
 * domain helpers and the server derives the actor solely from the verified
 * bearer token. Errors are thrown as `Error` with the server envelope
 * message via `unwrapApiResult`.
 *
 * PUT / timezone mutation remains HITL-gated and is not exposed here;
 * see server route comment for policy.
 */
import type { GetTimeContextResponse } from "@ega/contracts/time-context";

import { getMobileEgaApiClient, unwrapApiResult } from "@/lib/api/ega";

export async function fetchMobileTimeContext(query?: {
  timezone?: string | null;
  date?: string | null;
}): Promise<GetTimeContextResponse> {
  return unwrapApiResult(
    await getMobileEgaApiClient().timeContext.get(query),
  );
}

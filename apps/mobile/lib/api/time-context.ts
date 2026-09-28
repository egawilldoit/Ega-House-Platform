/**
 * Mobile Time Context API — typed wrapper over the @ega/api-client
 * timeContext surface (canonical GET/PUT /api/time-context), bound to the
 * mobile session token.
 *
 *   GET  /api/time-context[?timezone][&date] -> GetTimeContextResponse
 *   PUT  /api/time-context { timezone }     -> SetTimeContextResponse
 *
 * Same owner/timezone/date yields identical web/mobile semantics (DST,
 * midnight adjacency, Asia/Tokyo, server-TZ invariance, historical
 * reproducibility, invalid IANA fallback) because both transports share
 * domain helpers and the server derives the actor solely from the verified
 * bearer token. Errors are thrown as `Error` with the server envelope
 * message via `unwrapApiResult`.
 *
 * The PUT write is owner-scoped by the bearer token and RLS; the device
 * timezone is never sent implicitly — callers pass an explicit IANA zone.
 */
import type {
  GetTimeContextResponse,
  SetTimeContextResponse,
} from "@ega/contracts/time-context";

import { getMobileEgaApiClient, unwrapApiResult } from "@/lib/api/ega";

export async function fetchMobileTimeContext(query?: {
  timezone?: string | null;
  date?: string | null;
}): Promise<GetTimeContextResponse> {
  return unwrapApiResult(
    await getMobileEgaApiClient().timeContext.get(query),
  );
}

export async function setMobileTimezone(
  timezone: string,
): Promise<SetTimeContextResponse> {
  return unwrapApiResult(
    await getMobileEgaApiClient().timeContext.set({ timezone }),
  );
}

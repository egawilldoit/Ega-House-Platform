/**
 * Mobile Friction API — typed wrapper over the @ega/api-client friction surface
 * (canonical Hono transport), bound to the mobile session token.
 *
 *   GET /api/friction/radar -> FrictionRadarResponse
 *
 * Response carries deterministic threshold and owner-scoped blocked/stale signals.
 * No threshold recalculation happens here; rendering uses the shared read model.
 */
import type { FrictionRadarResponse } from "@ega/contracts/friction";
import { getMobileEgaApiClient, unwrapApiResult } from "@/lib/api/ega";

export async function fetchMobileFrictionRadar(): Promise<FrictionRadarResponse> {
  return unwrapApiResult(await getMobileEgaApiClient().friction.radar());
}

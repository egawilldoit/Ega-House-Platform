/**
 * Mobile Health API — typed wrapper over @ega/api-client healthSnapshot surface
 * GET /api/health/snapshot -> HealthSnapshotResponse
 */
import type { HealthSnapshotResponse } from "@ega/api-client";
import { getMobileEgaApiClient, unwrapApiResult } from "@/lib/api/ega";

export async function fetchMobileHealthSnapshot(input?: {
  timezone?: string;
  includeOpenSessions?: boolean;
}): Promise<HealthSnapshotResponse> {
  return unwrapApiResult(
    await getMobileEgaApiClient().healthSnapshot.getSnapshot(input),
  );
}

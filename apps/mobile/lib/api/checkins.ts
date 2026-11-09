import type {
  DailyCheckin,
  DailyCheckinPatch,
} from '@ega/contracts/checkins';
import { getMobileEgaApiClient, unwrapApiResult } from '@/lib/api/ega';

/**
 * Mobile daily check-in API — typed wrappers over the @ega/api-client
 * checkins surface (canonical Hono transport), bound to the mobile session.
 * Owner identity is derived server-side; callers never send an owner id.
 */
export async function fetchMobileDailyCheckin(
  localDate: string,
  timezone: string,
): Promise<DailyCheckin | null> {
  const response = unwrapApiResult(
    await getMobileEgaApiClient().checkins.get(localDate, timezone),
  );
  return response.checkin;
}

export async function saveMobileDailyCheckin(
  localDate: string,
  timezone: string,
  patch: DailyCheckinPatch,
): Promise<DailyCheckin> {
  const response = unwrapApiResult(
    await getMobileEgaApiClient().checkins.save({ localDate, timezone, patch }),
  );
  return response.checkin;
}

import type { DailyCheckin } from "@ega/domain/checkins";
import type { DailyCheckinPatch } from "@ega/domain/checkins";

export type { DailyCheckin, DailyCheckinPatch } from "@ega/domain/checkins";

/**
 * Wire contracts for the canonical daily check-in (PO-15, issue #360).
 * Only qualitative fields ride the wire; task completion and timer totals
 * stay derived from their canonical sources on the server.
 */

export type DailyCheckinDto = DailyCheckin;

export type GetDailyCheckinResponse = Readonly<{
  ok: true;
  checkin: DailyCheckinDto | null;
}>;

export type SaveDailyCheckinRequest = Readonly<{
  localDate: string;
  timezone: string;
  patch: DailyCheckinPatch;
}>;

export type SaveDailyCheckinResponse = Readonly<{
  ok: true;
  checkin: DailyCheckinDto;
  overtimeAdvisory: string | null;
}>;

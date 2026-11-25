import assert from "node:assert/strict";
import test from "node:test";

import { executeCalendarSyncCron } from "@/lib/cron/calendar-sync-cron";

test("executeCalendarSyncCron returns 200 when both v2 recovery and legacy drain succeed", async () => {
  const response = await executeCalendarSyncCron("https://ega.example", {
    runRecovery: async () => ({
      ok: true,
      data: { runsProcessed: 1, destinationsProcessed: 1, jobsProcessed: 2 },
    }),
    processLegacy: async () => ({ ok: true, processed: 0, failed: 0 }),
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok: boolean };
  assert.equal(body.ok, true);
});

test("executeCalendarSyncCron returns 500 when v2 recovery discovery fails", async () => {
  const response = await executeCalendarSyncCron("https://ega.example", {
    runRecovery: async () => ({
      ok: false,
      errorMessage: "Unable to load active Calendar sync runs.",
    }),
    processLegacy: async () => ({ ok: true, processed: 0, failed: 0 }),
  });

  assert.equal(response.status, 500);
  const body = (await response.json()) as {
    ok: boolean;
    recovery: { error?: string };
  };
  assert.equal(body.ok, false);
  assert.equal(body.recovery.error, "Unable to load active Calendar sync runs.");
});

test("executeCalendarSyncCron returns 500 when legacy drain fails", async () => {
  const response = await executeCalendarSyncCron("https://ega.example", {
    runRecovery: async () => ({
      ok: true,
      data: { runsProcessed: 0, destinationsProcessed: 0, jobsProcessed: 0 },
    }),
    processLegacy: async () => ({
      ok: false,
      processed: 0,
      failed: 0,
      error: "Unable to load Calendar sync jobs.",
    }),
  });

  assert.equal(response.status, 500);
  const body = (await response.json()) as { ok: boolean };
  assert.equal(body.ok, false);
});

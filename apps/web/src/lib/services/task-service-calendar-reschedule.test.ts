import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRescheduledWallWindow,
  rescheduleTaskDateForOwner,
  rescheduleTaskScheduledWindowForOwner,
} from "./task-service";

type Row = Record<string, unknown>;

function stubSupabase(
  row: Row | null,
  options: { writeRow?: boolean; error?: unknown } = {},
) {
  const filters: Array<{ column: string; value: unknown }> = [];
  const updates: Row[] = [];
  const inserts: Array<{ table: string; payload: Row }> = [];

  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: "owner-1" } }, error: null }),
    },
    from(table: string) {
      if (table === "tasks") {
        return {
          select() {
            const query = {
              eq(column: string, value: unknown) {
                filters.push({ column, value });
                return query;
              },
              async maybeSingle() {
                return { data: row, error: options.error ?? null };
              },
            };
            return query;
          },
          update(payload: Row) {
            updates.push(payload);
            const query = {
              eq(column: string, value: unknown) {
                filters.push({ column, value });
                return query;
              },
              select() {
                return {
                  async maybeSingle() {
                    return {
                      data: options.writeRow === false ? null : { id: "task-1" },
                      error: null,
                    };
                  },
                };
              },
              then(resolve: (value: { error: null }) => unknown) {
                return Promise.resolve({ error: null }).then(resolve);
              },
            };
            return query;
          },
        };
      }

      if (table === "calendar_sync_jobs") {
        return {
          insert: async (payload: Row) => {
            inserts.push({ table, payload });
            return { error: null };
          },
        };
      }

      if (table === "task_sessions") {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: [], error: null }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return { client, filters, updates, inserts };
}

const BASE_ROW: Row = {
  id: "task-1",
  owner_user_id: "owner-1",
  title: "Draft review",
  description: null,
  status: "todo",
  priority: "high",
  due_date: "2026-05-01",
  planned_for_date: "2026-05-02",
  scheduled_start_at: null,
  scheduled_end_at: null,
  calendar_sync_enabled: false,
  calendar_event_id: null,
  estimate_minutes: 60,
  blocked_reason: null,
  completed_at: null,
  archived_at: null,
  updated_at: "2026-05-01T10:00:00.000Z",
};

test("a due-date move writes only the due date and never scheduled fields", async () => {
  const stub = stubSupabase(BASE_ROW);

  const result = await rescheduleTaskDateForOwner(
    { taskId: "task-1", field: "due", date: "2026-05-04" },
    { supabase: stub.client as never },
  );

  assert.deepEqual(result, { errorMessage: null, changed: true });
  assert.equal(stub.updates.length, 1);
  assert.equal(stub.updates[0].due_date, "2026-05-04");
  assert.equal("planned_for_date" in stub.updates[0], false);
  assert.equal("scheduled_start_at" in stub.updates[0], false);
  assert.equal("scheduled_end_at" in stub.updates[0], false);
  assert.equal("duration_seconds" in stub.updates[0], false);
});

test("a planned-date move writes only the planned date", async () => {
  const stub = stubSupabase(BASE_ROW);

  const result = await rescheduleTaskDateForOwner(
    { taskId: "task-1", field: "planned", date: "2026-05-05" },
    { supabase: stub.client as never },
  );

  assert.deepEqual(result, { errorMessage: null, changed: true });
  assert.equal(stub.updates.length, 1);
  assert.equal(stub.updates[0].planned_for_date, "2026-05-05");
  assert.equal(stub.updates[0].due_date, "2026-05-01");
  assert.equal("scheduled_start_at" in stub.updates[0], false);
});

test("an invalid date is rejected before any write", async () => {
  const stub = stubSupabase(BASE_ROW);

  const result = await rescheduleTaskDateForOwner(
    { taskId: "task-1", field: "due", date: "2026-02-30" },
    { supabase: stub.client as never },
  );

  assert.ok(result.errorMessage?.includes("valid date"));
  assert.equal(stub.updates.length, 0);
});

test("an unsupported date field is rejected before any read", async () => {
  const stub = stubSupabase(BASE_ROW);

  const result = await rescheduleTaskDateForOwner(
    { taskId: "task-1", field: "start" as never, date: "2026-05-04" },
    { supabase: stub.client as never },
  );

  assert.equal(result.errorMessage, "Unsupported calendar date field.");
  assert.deepEqual(stub.filters, []);
});

test("a duplicate submit that matches the stored date is a successful no-op", async () => {
  const stub = stubSupabase(BASE_ROW);

  const result = await rescheduleTaskDateForOwner(
    { taskId: "task-1", field: "due", date: "2026-05-01" },
    { supabase: stub.client as never },
  );

  assert.deepEqual(result, { errorMessage: null, changed: false });
  assert.equal(stub.updates.length, 0);
});

test("a stale calendar render is rejected instead of overwriting a newer edit", async () => {
  const stub = stubSupabase(BASE_ROW);

  const result = await rescheduleTaskDateForOwner(
    {
      taskId: "task-1",
      field: "due",
      date: "2026-05-04",
      expectedUpdatedAt: "2026-04-30T09:00:00.000Z",
    },
    { supabase: stub.client as never },
  );

  assert.equal(
    result.errorMessage,
    "This task changed since you opened it. Reload and try again.",
  );
  assert.equal(stub.updates.length, 0);
});

test("the owner filter is applied to both the read and the guarded write", async () => {
  const stub = stubSupabase(BASE_ROW);

  await rescheduleTaskDateForOwner(
    { taskId: "task-1", field: "due", date: "2026-05-04" },
    { supabase: stub.client as never },
  );

  assert.ok(
    stub.filters.some(
      (filter) => filter.column === "owner_user_id" && filter.value === "owner-1",
    ),
  );
  assert.ok(
    stub.filters.some(
      (filter) => filter.column === "updated_at" && filter.value === BASE_ROW.updated_at,
    ),
  );
});

test("a date move enqueues Google Calendar resync only when sync is enabled", async () => {
  const withoutSync = stubSupabase(BASE_ROW);
  await rescheduleTaskDateForOwner(
    { taskId: "task-1", field: "due", date: "2026-05-04" },
    { supabase: withoutSync.client as never },
  );
  assert.equal(withoutSync.inserts.length, 0);

  const withSync = stubSupabase({
    ...BASE_ROW,
    calendar_sync_enabled: true,
    scheduled_start_at: "2026-05-01T09:00:00.000Z",
    scheduled_end_at: "2026-05-01T10:00:00.000Z",
  });
  const result = await rescheduleTaskDateForOwner(
    { taskId: "task-1", field: "due", date: "2026-05-04" },
    { supabase: withSync.client as never },
  );

  assert.deepEqual(result, { errorMessage: null, changed: true });
  assert.equal(withSync.inserts.length, 1);
  assert.equal(withSync.inserts[0].table, "calendar_sync_jobs");
  assert.equal(withSync.inserts[0].payload.owner_user_id, "owner-1");
  assert.equal(withSync.inserts[0].payload.operation, "upsert");
  // Fresh queue rows stay pending with a zero attempt count; the cron retry
  // path owns later failures, not the calendar mutation.
  assert.equal(withSync.inserts[0].payload.status, "pending");
  assert.equal(withSync.inserts[0].payload.attempts, 0);
});

test("buildRescheduledWallWindow preserves the wall-clock duration", () => {
  const window = buildRescheduledWallWindow({
    currentStartIso: "2026-05-06T09:00:00.000Z",
    currentEndIso: "2026-05-06T10:30:00.000Z",
    timezone: "Africa/Casablanca",
    targetDate: "2026-05-08",
  });

  assert.ok("startLocal" in window);
  assert.equal(window.startLocal, "2026-05-08T10:00");
  assert.equal(window.endLocal, "2026-05-08T11:30");
});

test("a scheduled block move writes UTC instants through the timezone validator", async () => {
  const stub = stubSupabase({
    ...BASE_ROW,
    calendar_sync_enabled: true,
    scheduled_start_at: "2026-05-06T09:00:00.000Z",
    scheduled_end_at: "2026-05-06T10:30:00.000Z",
  });

  const result = await rescheduleTaskScheduledWindowForOwner(
    { taskId: "task-1", date: "2026-05-08", time: "14:00" },
    { supabase: stub.client as never, accountTimezone: "Africa/Casablanca" },
  );

  assert.deepEqual(result, { errorMessage: null, changed: true });
  assert.ok(stub.updates.length >= 1);
  // 14:00–15:30 Casablanca (+01) is 13:00–14:30 UTC, preserving 90 minutes.
  assert.equal(stub.updates[0].scheduled_start_at, "2026-05-08T13:00:00.000Z");
  assert.equal(stub.updates[0].scheduled_end_at, "2026-05-08T14:30:00.000Z");
  // updateTaskInline owns the resync enqueue for scheduled moves.
  assert.equal(stub.inserts.length, 1);
  assert.equal(stub.inserts[0].table, "calendar_sync_jobs");
});

test("a scheduled block without a stored window is rejected", async () => {
  const stub = stubSupabase(BASE_ROW);

  const result = await rescheduleTaskScheduledWindowForOwner(
    { taskId: "task-1", date: "2026-05-08", time: "14:00" },
    { supabase: stub.client as never, accountTimezone: "Africa/Casablanca" },
  );

  assert.equal(result.errorMessage, "This task has no scheduled block to move.");
  assert.equal(stub.updates.length, 0);
});

test("a DST gap target is rejected by the canonical schedule validator", async () => {
  const stub = stubSupabase({
    ...BASE_ROW,
    scheduled_start_at: "2026-03-21T08:00:00.000Z",
    scheduled_end_at: "2026-03-21T09:00:00.000Z",
  });

  const result = await rescheduleTaskScheduledWindowForOwner(
    { taskId: "task-1", date: "2026-03-22", time: "02:30" },
    { supabase: stub.client as never, accountTimezone: "Africa/Casablanca" },
  );

  assert.ok(result.errorMessage?.includes("does not exist"));
  assert.equal(stub.updates.length, 0);
});

test("moving a scheduled block to the same local day/time is a no-op", async () => {
  const stub = stubSupabase({
    ...BASE_ROW,
    scheduled_start_at: "2026-05-06T09:00:00.000Z",
    scheduled_end_at: "2026-05-06T10:00:00.000Z",
  });

  const result = await rescheduleTaskScheduledWindowForOwner(
    { taskId: "task-1", date: "2026-05-06", time: "10:00" },
    { supabase: stub.client as never, accountTimezone: "Africa/Casablanca" },
  );

  assert.deepEqual(result, { errorMessage: null, changed: false });
  assert.equal(stub.updates.length, 0);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  enqueueCalendarSyncJob,
  processPendingCalendarSyncJobs,
} from "./calendar-sync-service";

function createCalendarSyncSupabaseMock(options?: { settingsLoadError?: boolean }) {
  const tasks = [
    {
      id: "task-1",
      owner_user_id: "owner-1",
      title: "Deep work",
      scheduled_start_at: "2026-05-10T09:00:00.000Z",
      scheduled_end_at: "2026-05-10T10:00:00.000Z",
      calendar_sync_enabled: true,
      calendar_reminder_minutes: 15,
      calendar_event_id: null as string | null,
      calendar_sync_status: null as string | null,
      calendar_sync_failure_reason: null as string | null,
      archived_at: null as string | null,
      updated_at: "2026-05-10T08:00:00.000Z",
    },
  ];
  const jobs: Array<Record<string, unknown>> = [];
  const settings = {
    owner_user_id: "owner-1",
    provider: "google",
    google_account_email: "owner@example.com",
    scheduled_task_sync_enabled: true,
    default_reminder_minutes: 15,
    calendar_id: "primary",
    access_token_encrypted: "access-token",
    refresh_token_encrypted: "refresh-token",
    token_expires_at: "2999-01-01T00:00:00.000Z",
    connected_at: "2026-05-10T08:00:00.000Z",
    disconnected_at: null,
  };

  function queryRows(table: string, filters: Record<string, unknown>) {
    const rows =
      table === "tasks"
        ? tasks
        : table === "calendar_sync_jobs"
          ? jobs
          : [settings];

    return rows.filter((row) =>
      Object.entries(filters).every(([column, value]) => row[column] === value),
    );
  }

  function createQuery(table: string, action?: "update", payload?: Record<string, unknown>) {
    const filters: Record<string, unknown> = {};
    const inFilters: Record<string, unknown[]> = {};
    let selected = false;

    const query = {
      select() {
        selected = true;
        return query;
      },
      eq(column: string, value: unknown) {
        filters[column] = value;
        return query;
      },
      in(column: string, values: unknown[]) {
        inFilters[column] = values;
        return query;
      },
      lt() {
        return query;
      },
      order() {
        return query;
      },
      async limit(limit: number) {
        const rows = queryRows(table, filters).filter((row) =>
          Object.entries(inFilters).every(([column, values]) =>
            values.includes(row[column]),
          ),
        );
        return { data: rows.slice(0, limit), error: null };
      },
      async maybeSingle() {
        if (table === "calendar_integration_settings" && options?.settingsLoadError) {
          return { data: null, error: new Error("settings unavailable") };
        }

        const rows = queryRows(table, filters).filter((row) =>
          Object.entries(inFilters).every(([column, values]) =>
            values.includes(row[column]),
          ),
        );
        if (action === "update" && rows[0]) {
          Object.assign(rows[0], payload);
        }
        return { data: selected ? rows[0] ?? null : null, error: null };
      },
      then(resolve: (value: { data: null; error: null }) => void) {
        if (action === "update") {
          const rows = queryRows(table, filters).filter((row) =>
            Object.entries(inFilters).every(([column, values]) =>
              values.includes(row[column]),
            ),
          );
          for (const row of rows) {
            Object.assign(row, payload);
          }
        }
        resolve({ data: null, error: null });
      },
    };
    (query as unknown as { filters: Record<string, unknown> }).filters = filters;

    return query;
  }

  const supabase = {
    auth: {
      async getUser() {
        return { data: { user: { id: "owner-1" } }, error: null };
      },
    },
    from(table: string) {
      return {
        select() {
          return createQuery(table).select();
        },
        update(payload: Record<string, unknown>) {
          return createQuery(table, "update", payload);
        },
        async insert(payload: Record<string, unknown>) {
          jobs.push({
            id: `job-${jobs.length + 1}`,
            created_at: "2026-05-10T08:00:00.000Z",
            locked_at: null,
            last_error: null,
            ...payload,
          });
          return { data: null, error: null };
        },
      };
    },
  };

  return { jobs, settings, supabase, tasks };
}

test("enqueueCalendarSyncJob marks task pending and inserts an outbox row", async () => {
  const mock = createCalendarSyncSupabaseMock();

  const result = await enqueueCalendarSyncJob(
    { taskId: "task-1", operation: "upsert" },
    {
      supabase: mock.supabase as never,
      nowIso: "2026-05-10T09:00:00.000Z",
    },
  );

  assert.equal(result.errorMessage, null);
  assert.equal(mock.tasks[0]?.calendar_sync_status, "pending");
  assert.equal(mock.jobs.length, 1);
  assert.equal(mock.jobs[0]?.operation, "upsert");
});

test("processPendingCalendarSyncJobs creates Google event and marks job succeeded", async () => {
  const mock = createCalendarSyncSupabaseMock();
  await enqueueCalendarSyncJob(
    { taskId: "task-1", operation: "upsert" },
    { supabase: mock.supabase as never },
  );

  const result = await processPendingCalendarSyncJobs({
    supabase: mock.supabase as never,
    nowIso: "2026-05-10T09:00:00.000Z",
    client: {
      async createEvent() {
        return { eventId: "google-event-1", errorMessage: null };
      },
      async patchEvent() {
        throw new Error("patch should not be called");
      },
      async deleteEvent() {
        throw new Error("delete should not be called");
      },
    },
  });

  assert.deepEqual(result, { ok: true, processed: 1, failed: 0 });
  assert.equal(mock.jobs[0]?.status, "succeeded");
  assert.equal(mock.tasks[0]?.calendar_event_id, "google-event-1");
  assert.equal(mock.tasks[0]?.calendar_sync_status, "synced");
});

test("processPendingCalendarSyncJobs fails without clearing event id when credentials fail to load", async () => {
  const mock = createCalendarSyncSupabaseMock({ settingsLoadError: true });
  mock.tasks[0]!.calendar_event_id = "google-event-1";
  await enqueueCalendarSyncJob(
    { taskId: "task-1", operation: "upsert" },
    { supabase: mock.supabase as never },
  );

  const result = await processPendingCalendarSyncJobs({
    supabase: mock.supabase as never,
    nowIso: "2026-05-10T09:00:00.000Z",
    client: {
      async createEvent() {
        throw new Error("create should not be called");
      },
      async patchEvent() {
        throw new Error("patch should not be called");
      },
      async deleteEvent() {
        throw new Error("delete should not be called");
      },
    },
  });

  assert.deepEqual(result, { ok: true, processed: 0, failed: 1 });
  assert.equal(mock.jobs[0]?.status, "failed");
  assert.equal(mock.tasks[0]?.calendar_event_id, "google-event-1");
  assert.equal(mock.tasks[0]?.calendar_sync_status, "failed");
  assert.equal(
    mock.tasks[0]?.calendar_sync_failure_reason,
    "Unable to load Calendar credentials right now.",
  );
});

test("processPendingCalendarSyncJobs persists refreshed token for orphan delete jobs", async () => {
  const mock = createCalendarSyncSupabaseMock();
  mock.tasks.length = 0;
  mock.jobs.push({
    id: "job-1",
    owner_user_id: "owner-1",
    task_id: "deleted-task",
    calendar_event_id: "google-event-1",
    operation: "delete",
    status: "pending",
    attempts: 0,
    created_at: "2026-05-10T08:00:00.000Z",
    locked_at: null,
    last_error: null,
  });

  const result = await processPendingCalendarSyncJobs({
    supabase: mock.supabase as never,
    nowIso: "2026-05-10T09:00:00.000Z",
    client: {
      async createEvent() {
        throw new Error("create should not be called");
      },
      async patchEvent() {
        throw new Error("patch should not be called");
      },
      async deleteEvent() {
        return {
          ok: true,
          errorMessage: null,
          refreshedAccessToken: "new-access-token",
          tokenExpiresAt: "2026-05-10T10:00:00.000Z",
        };
      },
    },
  });

  assert.deepEqual(result, { ok: true, processed: 1, failed: 0 });
  assert.equal(mock.jobs[0]?.status, "succeeded");
  assert.equal(mock.settings.access_token_encrypted, "new-access-token");
  assert.equal(mock.settings.token_expires_at, "2026-05-10T10:00:00.000Z");
});

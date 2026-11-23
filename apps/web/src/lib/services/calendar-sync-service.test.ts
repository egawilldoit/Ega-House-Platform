import assert from "node:assert/strict";
import test from "node:test";

import {
  enqueueCalendarSyncJob,
  processPendingCalendarSyncJobs,
} from "./calendar-sync-service";

function createCalendarSyncSupabaseMock(options?: { settingsLoadError?: boolean; claimBeforeCoalesce?: boolean }) {
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
  let claimBeforeCoalesce = options?.claimBeforeCoalesce;
  const mappings: Array<Record<string, unknown>> = [];
  const settings = {
    owner_user_id: "owner-1",
    provider: "google",
    google_account_email: "owner@example.com",
    google_account_subject: null as string | null,
    scheduled_task_sync_enabled: true,
    default_reminder_minutes: 15,
    calendar_id: "primary",
    access_token_encrypted: "access-token",
    refresh_token_encrypted: "refresh-token",
    token_expires_at: "2999-01-01T00:00:00.000Z",
    connected_at: "2026-05-10T08:00:00.000Z",
    disconnected_at: null,
    updated_at: "2026-05-10T08:00:00.000Z",
  };

  function queryRows(table: string, filters: Record<string, unknown>) {
    const rows =
      table === "tasks"
        ? tasks
        : table === "calendar_sync_jobs"
          ? jobs
          : table === "calendar_event_mappings"
            ? [...mappings].sort(
                (a, b) => Number(b.generation ?? 0) - Number(a.generation ?? 0),
              )
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
      limit(limit: number) {
        const rows = queryRows(table, filters).filter((row) =>
          Object.entries(inFilters).every(([column, values]) =>
            values.includes(row[column]),
          ),
        );
        const result = { data: rows.slice(0, limit), error: null };
        return {
          ...result,
          then(resolve: (value: typeof result) => void) {
            resolve(result);
          },
          async maybeSingle() {
            return { data: result.data[0] ?? null, error: null };
          },
        };
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
        return { data: selected && rows[0] ? { ...rows[0] } : null, error: null };
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
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === "calendar_sync_promote_legacy_job") {
        const job = jobs.find((row) => row.id === args.p_job_id && row.claim_token === args.p_claim_token && row.status === "processing");
        if (!job) return { data: false, error: null };
        Object.assign(job, { queue_version: 2, status: "pending", claim_token: null });
        return { data: true, error: null };
      }
      if (name === "calendar_sync_complete_legacy_job") {
        const job = jobs.find((row) => row.id === args.p_job_id && row.claim_token === args.p_claim_token && row.status === "processing");
        if (!job) return { data: false, error: null };
        Object.assign(job, { status: args.p_status, attempts: Number(job.attempts) + 1, last_error: args.p_failure_reason, claim_token: null });
        const task = tasks.find((row) => row.id === job.task_id && row.owner_user_id === job.owner_user_id);
        if (task) Object.assign(task, { calendar_sync_status: args.p_task_status, calendar_event_id: args.p_event_id, calendar_sync_failure_reason: args.p_failure_reason });
        return { data: true, error: null };
      }
      if (name !== "calendar_sync_upsert_mapping") {
        throw new Error(`unexpected rpc: ${name}`);
      }
      mappings.push({
        id: `mapping-${mappings.length + 1}`,
        owner_user_id: args.p_owner_user_id,
        task_id: args.p_task_id,
        destination_key: args.p_destination_key,
        google_account_subject: args.p_google_account_subject,
        google_account_email: args.p_google_account_email,
        calendar_id: args.p_calendar_id,
        event_id: args.p_event_id,
        generation: args.p_generation,
        status: "active",
        updated_at: args.p_now,
      });
      return { data: [], error: null };
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
          if (claimBeforeCoalesce) {
            claimBeforeCoalesce = false;
            const pending = jobs.find((job) => job.status === "pending");
            assert.ok(pending);
            pending.status = "processing";
            return { data: null, error: { code: "23505" } };
          }
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

  return { jobs, mappings, settings, supabase, tasks };
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

test("first scheduled publish is queued for durable recovery", async () => {
  const mock = createCalendarSyncSupabaseMock();
  await enqueueCalendarSyncJob({ taskId: "task-1" }, { supabase: mock.supabase as never });
  assert.equal(mock.jobs[0]?.queue_version, 2);
  assert.equal(mock.jobs[0]?.event_exists, false);
  assert.ok(mock.jobs[0]?.calendar_event_id);
});

test("a claimed legacy first publish is promoted without a Google write", async () => {
  const mock = createCalendarSyncSupabaseMock();
  await enqueueCalendarSyncJob({ taskId: "task-1" }, { supabase: mock.supabase as never });
  mock.jobs[0]!.queue_version = 1;
  const result = await processPendingCalendarSyncJobs({
    supabase: mock.supabase as never, nowIso: "2026-05-10T09:00:00.000Z",
    client: {
      async createEvent() { throw new Error("unexpected create"); },
      async patchEvent() { throw new Error("unexpected patch"); },
      async deleteEvent() { throw new Error("unexpected delete"); },
    },
  });
  assert.deepEqual(result, { ok: true, processed: 0, failed: 0 });
  assert.equal(mock.jobs[0]?.queue_version, 2);
  assert.equal(mock.jobs[0]?.status, "pending");
});

test("processPendingCalendarSyncJobs fails without clearing event id when credentials fail to load", async () => {
  const mock = createCalendarSyncSupabaseMock({ settingsLoadError: true });
  mock.tasks[0]!.calendar_event_id = "google-event-1";
  await enqueueCalendarSyncJob(
    { taskId: "task-1", operation: "upsert" },
    { supabase: mock.supabase as never },
  );
  Object.assign(mock.jobs[0]!, { queue_version: 1, event_exists: true, calendar_event_id: "event-a" });

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
    queue_version: 1,
    event_exists: true,
    generation: 1,
    destination_key: "owner@example.com|primary",
    google_account_subject: null,
    google_account_email: "owner@example.com",
    calendar_id: "primary",
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

test("a reconnect during token refresh keeps the new connection credentials", async () => {
  const mock = createCalendarSyncSupabaseMock();
  await enqueueCalendarSyncJob(
    { taskId: "task-1", operation: "upsert" },
    { supabase: mock.supabase as never },
  );
  Object.assign(mock.jobs[0]!, { queue_version: 1, event_exists: true, calendar_event_id: "event-a" });
  await processPendingCalendarSyncJobs({
    supabase: mock.supabase as never,
    nowIso: "2026-05-10T09:00:00.000Z",
    client: {
      async patchEvent() {
        Object.assign(mock.settings, {
          google_account_email: "new@example.com",
          access_token_encrypted: "new-access",
          refresh_token_encrypted: "new-refresh",
          updated_at: "2026-05-10T08:59:00.000Z",
        });
        return { eventId: "event-a", errorMessage: null,
          refreshedAccessToken: "stale-access", tokenExpiresAt: null };
      },
      async createEvent() { throw new Error("unexpected create"); },
      async deleteEvent() { throw new Error("unexpected delete"); },
    },
  });
  assert.equal(mock.settings.google_account_email, "new@example.com");
  assert.equal(mock.settings.access_token_encrypted, "new-access");
  assert.equal(mock.settings.refresh_token_encrypted, "new-refresh");
});

test("processPendingCalendarSyncJobs pauses a job queued for a different Google account", async () => {
  const mock = createCalendarSyncSupabaseMock();
  await enqueueCalendarSyncJob(
    { taskId: "task-1", operation: "upsert" },
    { supabase: mock.supabase as never },
  );
  Object.assign(mock.jobs[0]!, { queue_version: 1, event_exists: true, calendar_event_id: "event-a" });
  assert.equal(mock.jobs[0]?.destination_key, "owner@example.com|primary");

  // The owner reconnects with another Google account before the queued job
  // runs. The job's stamped destination no longer matches the credentials.
  mock.settings.google_account_email = "new@example.com";

  const writes: string[] = [];
  const result = await processPendingCalendarSyncJobs({
    supabase: mock.supabase as never,
    nowIso: "2026-05-10T09:00:00.000Z",
    client: {
      async createEvent() {
        writes.push("create");
        return { eventId: "wrong-account-event", errorMessage: null };
      },
      async patchEvent() {
        writes.push("patch");
        return { eventId: "wrong-account-event", errorMessage: null };
      },
      async deleteEvent() {
        writes.push("delete");
        return { ok: true, errorMessage: null };
      },
    },
  });

  assert.deepEqual(result, { ok: true, processed: 0, failed: 1 });
  assert.deepEqual(writes, []);
  assert.equal(mock.jobs[0]?.status, "failed");
  assert.equal(mock.tasks[0]?.calendar_event_id, null);
  assert.equal(mock.tasks[0]?.calendar_sync_status, "failed");
  assert.match(
    String(mock.tasks[0]?.calendar_sync_failure_reason),
    /could not be verified/,
  );
});

test("processPendingCalendarSyncJobs never writes a job without a destination stamp", async () => {
  const mock = createCalendarSyncSupabaseMock();
  mock.jobs.push({
    id: "unstamped-job",
    owner_user_id: "owner-1",
    task_id: "task-1",
    calendar_event_id: null,
    operation: "upsert",
    status: "pending",
    attempts: 0,
    queue_version: 1,
    created_at: "2026-05-10T08:00:00.000Z",
    locked_at: null,
    last_error: null,
  });

  const writes: string[] = [];
  const result = await processPendingCalendarSyncJobs({
    supabase: mock.supabase as never,
    nowIso: "2026-05-10T09:00:00.000Z",
    client: {
      async createEvent() {
        writes.push("create");
        return { eventId: "wrong-account-event", errorMessage: null };
      },
      async patchEvent() {
        writes.push("patch");
        return { eventId: "wrong-account-event", errorMessage: null };
      },
      async deleteEvent() {
        writes.push("delete");
        return { ok: true, errorMessage: null };
      },
    },
  });

  assert.deepEqual(result, { ok: true, processed: 0, failed: 1 });
  assert.deepEqual(writes, []);
  assert.equal(mock.jobs[0]?.status, "failed");
  assert.equal(mock.tasks[0]?.calendar_sync_status, "failed");
  assert.match(
    String(mock.tasks[0]?.calendar_sync_failure_reason),
    /could not be verified/,
  );
});

test("processPendingCalendarSyncJobs rejects a legacy job left unstamped by an account switch", async () => {
  const mock = createCalendarSyncSupabaseMock();
  // 0109 cannot establish the original destination of a job queued before a
  // connection switch, so it leaves the job unstamped with no account columns.
  mock.jobs.push({
    id: "unknown-provenance-job",
    owner_user_id: "owner-1",
    task_id: "task-1",
    calendar_event_id: "account-a-event",
    operation: "delete",
    status: "pending",
    attempts: 0,
    queue_version: 1,
    created_at: "2026-05-01T08:00:00.000Z",
    locked_at: null,
    last_error: null,
  });
  mock.settings.google_account_email = "new@example.com";
  mock.settings.calendar_id = "primary-b";
  mock.tasks[0].calendar_event_id = "account-a-event";

  const writes: string[] = [];
  const result = await processPendingCalendarSyncJobs({
    supabase: mock.supabase as never,
    nowIso: "2026-05-10T09:00:00.000Z",
    client: {
      async createEvent() {
        writes.push("create");
        return { eventId: "wrong-account-event", errorMessage: null };
      },
      async patchEvent() {
        writes.push("patch");
        return { eventId: "wrong-account-event", errorMessage: null };
      },
      async deleteEvent() {
        writes.push("delete");
        return { ok: true, errorMessage: null };
      },
    },
  });

  assert.deepEqual(result, { ok: true, processed: 0, failed: 1 });
  assert.deepEqual(writes, []);
  assert.equal(mock.jobs[0]?.status, "failed");
  assert.equal(mock.tasks[0]?.calendar_event_id, "account-a-event");
  assert.equal(mock.tasks[0]?.calendar_sync_status, "failed");
  assert.match(
    String(mock.tasks[0]?.calendar_sync_failure_reason),
    /could not be verified/,
  );
});

test("an account switch with no mapping history does not enqueue the old event id", async () => {
  const mock = createCalendarSyncSupabaseMock();
  mock.tasks[0].calendar_event_id = "account-a-event";
  mock.settings.google_account_email = "new@example.com";
  mock.settings.calendar_id = "primary-b";

  const result = await enqueueCalendarSyncJob(
    { taskId: "task-1", operation: "upsert", calendarEventId: "account-a-event" },
    { supabase: mock.supabase as never, nowIso: "2026-05-10T09:00:00.000Z" },
  );

  assert.equal(result.errorMessage, null);
  const job = mock.jobs[0];
  assert.equal(job?.destination_key, "new@example.com|primary-b");
  assert.notEqual(job?.calendar_event_id, "account-a-event");
  assert.equal(job?.event_exists, false);
  assert.equal(job?.queue_version, 2);
});

test("a delete with no mapping history never targets the previous account's event id", async () => {
  const mock = createCalendarSyncSupabaseMock();
  mock.tasks[0].calendar_event_id = "account-a-event";
  mock.settings.google_account_email = "new@example.com";
  mock.settings.calendar_id = "primary-b";

  await enqueueCalendarSyncJob(
    {
      taskId: "task-1",
      operation: "delete",
      calendarEventId: "account-a-event",
    },
    { supabase: mock.supabase as never },
  );
  const job = mock.jobs[0];
  assert.notEqual(job?.calendar_event_id, "account-a-event");
  assert.equal(job?.event_exists, false);

  const writes: string[] = [];
  const result = await processPendingCalendarSyncJobs({
    supabase: mock.supabase as never,
    nowIso: "2026-05-10T09:00:00.000Z",
    client: {
      async createEvent() {
        writes.push("create");
        return { eventId: "wrong-account-event", errorMessage: null };
      },
      async patchEvent() {
        writes.push("patch");
        return { eventId: "wrong-account-event", errorMessage: null };
      },
      async deleteEvent(input: { eventId: string }) {
        writes.push(`delete:${input.eventId}`);
        return { ok: true, errorMessage: null };
      },
    } as never,
  });

  assert.deepEqual(result, { ok: true, processed: 0, failed: 0 });
  assert.deepEqual(writes, []);
});

test("a missing-task delete requires scoped provenance before calling Google", async () => {
  function orphanDeleteMock(eventExists: boolean) {
    const mock = createCalendarSyncSupabaseMock();
    mock.tasks.length = 0;
    mock.jobs.push({
      id: "orphan-delete",
      owner_user_id: "owner-1",
      task_id: "deleted-task",
      calendar_event_id: "unscoped-event",
      operation: "delete",
      status: "pending",
      attempts: 0,
      queue_version: 1,
      event_exists: eventExists,
      generation: 1,
      destination_key: "owner@example.com|primary",
      google_account_subject: null,
      google_account_email: "owner@example.com",
      calendar_id: "primary",
      created_at: "2026-05-10T08:00:00.000Z",
      locked_at: null,
      last_error: null,
    });
    return mock;
  }

  const unscoped = orphanDeleteMock(false);
  const unscopedWrites: string[] = [];
  await processPendingCalendarSyncJobs({
    supabase: unscoped.supabase as never,
    nowIso: "2026-05-10T09:00:00.000Z",
    client: {
      async createEvent() {
        unscopedWrites.push("create");
        return { eventId: "unexpected", errorMessage: null };
      },
      async patchEvent() {
        unscopedWrites.push("patch");
        return { eventId: "unexpected", errorMessage: null };
      },
      async deleteEvent(input: { eventId: string }) {
        unscopedWrites.push(`delete:${input.eventId}`);
        return { ok: true, errorMessage: null };
      },
    } as never,
  });
  assert.deepEqual(unscopedWrites, []);

  const scoped = orphanDeleteMock(true);
  const scopedWrites: string[] = [];
  const result = await processPendingCalendarSyncJobs({
    supabase: scoped.supabase as never,
    nowIso: "2026-05-10T09:00:00.000Z",
    client: {
      async createEvent() {
        scopedWrites.push("create");
        return { eventId: "unexpected", errorMessage: null };
      },
      async patchEvent() {
        scopedWrites.push("patch");
        return { eventId: "unexpected", errorMessage: null };
      },
      async deleteEvent(input: { eventId: string }) {
        scopedWrites.push(`delete:${input.eventId}`);
        return { ok: true, errorMessage: null };
      },
    } as never,
  });
  assert.deepEqual(result, { ok: true, processed: 1, failed: 0 });
  assert.deepEqual(scopedWrites, ["delete:unscoped-event"]);
});

test("returning to account A uses its active mapping even when account B also has a mapping", async () => {
  const mock = createCalendarSyncSupabaseMock();
  mock.mappings.push(
    { owner_user_id: "owner-1", task_id: "task-1", destination_key: "owner@example.com|primary",
      event_id: "account-a-event", generation: 2, status: "active" },
    { owner_user_id: "owner-1", task_id: "task-1", destination_key: "other@example.com|primary",
      event_id: "account-b-event", generation: 4, status: "active" },
  );

  const result = await enqueueCalendarSyncJob(
    { taskId: "task-1", operation: "upsert" },
    { supabase: mock.supabase as never },
  );

  assert.equal(result.errorMessage, null);
  assert.equal(mock.jobs[0]?.calendar_event_id, "account-a-event");
  assert.equal(mock.jobs[0]?.event_exists, true);
  assert.equal(mock.jobs[0]?.run_id, null);
});

test("an edit is reinserted when the conflicting pending row is claimed before coalescing", async () => {
  const mock = createCalendarSyncSupabaseMock({ claimBeforeCoalesce: true });
  mock.jobs.push({
    id: "original-job", owner_user_id: "owner-1", task_id: "task-1",
    destination_key: "owner@example.com|primary", status: "pending", queue_version: 2,
  });

  const result = await enqueueCalendarSyncJob(
    { taskId: "task-1", operation: "upsert" },
    { supabase: mock.supabase as never },
  );

  assert.equal(result.errorMessage, null);
  assert.deepEqual(mock.jobs.map((job) => job.status), ["processing", "pending"]);
  assert.equal(mock.jobs[1]?.run_id, null);
});

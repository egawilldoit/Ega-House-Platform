import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCalendarSettingsViewHasNoSecrets,
  connectGoogleCalendarWithTokens,
  disconnectGoogleCalendar,
  getCalendarIntegrationSettings,
  getCalendarTaskFormDefaults,
  updateCalendarIntegrationDefaults,
} from "./calendar-settings-service";

type MockRow = {
  owner_user_id: string;
  provider: string;
  google_account_email: string | null;
  scheduled_task_sync_enabled: boolean;
  default_reminder_minutes: number;
  connected_at: string | null;
  disconnected_at: string | null;
};

function createCalendarSupabaseMock(options?: {
  userId?: string;
  row?: MockRow | null;
  upsertError?: Error;
}) {
  const calls: Array<{ column: string; value: unknown }> = [];
  const selectedColumns: string[] = [];
  const upsertPayloads: Record<string, unknown>[] = [];
  const upsertOptions: Record<string, unknown>[] = [];
  const userId = options?.userId ?? "user-1";
  let row = options?.row ?? null;

  const supabase = {
    auth: {
      async getUser() {
        return { data: { user: { id: userId } }, error: null };
      },
    },
    from(table: string) {
      assert.equal(table, "calendar_integration_settings");
      return {
        select(columns: string) {
          selectedColumns.push(columns);
          const query = {
            eq(column: string, value: unknown) {
              calls.push({ column, value });
              return query;
            },
            async maybeSingle() {
              return { data: row, error: null };
            },
          };
          return query;
        },
        upsert(payload: Record<string, unknown>, upsertOption?: Record<string, unknown>) {
          upsertPayloads.push(payload);
          if (upsertOption) {
            upsertOptions.push(upsertOption);
          }

          const existingRow = row;
          row = {
            owner_user_id: String(payload.owner_user_id ?? existingRow?.owner_user_id),
            provider: String(payload.provider ?? existingRow?.provider),
            google_account_email:
              (payload.google_account_email as string | null | undefined) ??
              existingRow?.google_account_email ??
              null,
            scheduled_task_sync_enabled:
              (payload.scheduled_task_sync_enabled as boolean | undefined) ??
              existingRow?.scheduled_task_sync_enabled ??
              false,
            default_reminder_minutes:
              (payload.default_reminder_minutes as number | undefined) ??
              existingRow?.default_reminder_minutes ??
              10,
            connected_at:
              (payload.connected_at as string | null | undefined) ??
              existingRow?.connected_at ??
              null,
            disconnected_at:
              (payload.disconnected_at as string | null | undefined) ??
              existingRow?.disconnected_at ??
              null,
          };

          return {
            select(columns: string) {
              selectedColumns.push(columns);
              return {
                async maybeSingle() {
                  if (options?.upsertError) {
                    return { data: null, error: options.upsertError };
                  }

                  return { data: row, error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  return {
    calls,
    selectedColumns,
    supabase,
    upsertOptions,
    upsertPayloads,
  };
}

test("missing Calendar settings use disconnected defaults", async () => {
  const mock = createCalendarSupabaseMock();
  const result = await getCalendarIntegrationSettings({
    supabase: mock.supabase as never,
  });

  assert.equal(result.errorMessage, null);
  assert.deepEqual(result.data, {
    connected: false,
    googleAccountEmail: null,
    scheduledTaskSyncEnabled: false,
    defaultReminderMinutes: 10,
  });
});

test("Calendar settings reads are owner-scoped and select no secrets", async () => {
  const mock = createCalendarSupabaseMock({
    userId: "owner-a",
    row: {
      owner_user_id: "owner-a",
      provider: "google",
      google_account_email: "owner@example.com",
      scheduled_task_sync_enabled: true,
      default_reminder_minutes: 15,
      connected_at: "2026-05-10T10:00:00.000Z",
      disconnected_at: null,
    },
  });

  const result = await getCalendarIntegrationSettings({
    supabase: mock.supabase as never,
  });

  assert.equal(result.data.connected, true);
  assert.equal(result.data.googleAccountEmail, "owner@example.com");
  assert.equal(result.data.scheduledTaskSyncEnabled, true);
  assert.equal(result.data.defaultReminderMinutes, 15);
  assert.deepEqual(mock.calls, [
    { column: "owner_user_id", value: "owner-a" },
    { column: "provider", value: "google" },
  ]);
  assert.equal(mock.selectedColumns.some((columns) => columns.includes("token")), false);
  assert.equal(assertCalendarSettingsViewHasNoSecrets(result.data), true);
});

test("disconnected Calendar never defaults task forms into sync", () => {
  const defaults = getCalendarTaskFormDefaults({
    connected: false,
    googleAccountEmail: null,
    scheduledTaskSyncEnabled: true,
    defaultReminderMinutes: 20,
  });

  assert.equal(defaults.calendarSyncEnabled, false);
  assert.equal(defaults.calendarReminderMinutes, 20);
});

test("Calendar defaults update is owner-scoped and normalizes reminder", async () => {
  const mock = createCalendarSupabaseMock({ userId: "owner-b" });
  const result = await updateCalendarIntegrationDefaults(
    {
      scheduledTaskSyncEnabled: "on",
      defaultReminderMinutes: "999999",
    },
    {
      supabase: mock.supabase as never,
      updatedAtIso: "2026-05-10T10:00:00.000Z",
    },
  );

  assert.equal(result.errorMessage, null);
  assert.deepEqual(mock.upsertPayloads[0], {
    owner_user_id: "owner-b",
    provider: "google",
    scheduled_task_sync_enabled: true,
    default_reminder_minutes: 10080,
    updated_at: "2026-05-10T10:00:00.000Z",
  });
  assert.deepEqual(mock.upsertOptions[0], {
    onConflict: "owner_user_id,provider",
  });
});

test("Google Calendar callback token persistence inserts first-time connection server-side and returns safe view", async () => {
  const mock = createCalendarSupabaseMock({ userId: "owner-c" });
  const result = await connectGoogleCalendarWithTokens(
    {
      accessToken: "google-access-token",
      refreshToken: "google-refresh-token",
      expiresInSeconds: 3600,
      googleAccountEmail: "owner@example.com",
    },
    {
      supabase: mock.supabase as never,
      updatedAtIso: "2026-05-10T10:00:00.000Z",
    },
  );

  assert.equal(result.data.connected, true);
  assert.equal(result.data.googleAccountEmail, "owner@example.com");
  assert.equal(mock.upsertPayloads[0]?.owner_user_id, "owner-c");
  assert.deepEqual(mock.upsertOptions[0], {
    onConflict: "owner_user_id,provider",
  });
  assert.equal(mock.upsertPayloads[0]?.access_token_encrypted, "google-access-token");
  assert.equal(mock.upsertPayloads[0]?.refresh_token_encrypted, "google-refresh-token");
  assert.equal(
    mock.upsertPayloads[0]?.token_expires_at,
    "2026-05-10T11:00:00.000Z",
  );
  assert.equal(assertCalendarSettingsViewHasNoSecrets(result.data), true);
});

test("Google Calendar callback token persistence updates existing settings row without changing defaults", async () => {
  const mock = createCalendarSupabaseMock({
    userId: "owner-existing",
    row: {
      owner_user_id: "owner-existing",
      provider: "google",
      google_account_email: "old@example.com",
      scheduled_task_sync_enabled: true,
      default_reminder_minutes: 45,
      connected_at: "2026-05-01T10:00:00.000Z",
      disconnected_at: null,
    },
  });

  const result = await connectGoogleCalendarWithTokens(
    {
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      expiresInSeconds: 1800,
      googleAccountEmail: "new@example.com",
    },
    {
      supabase: mock.supabase as never,
      updatedAtIso: "2026-05-10T10:00:00.000Z",
    },
  );

  assert.equal(result.errorMessage, null);
  assert.equal(result.data.connected, true);
  assert.equal(result.data.googleAccountEmail, "new@example.com");
  assert.equal(result.data.scheduledTaskSyncEnabled, true);
  assert.equal(result.data.defaultReminderMinutes, 45);
  assert.equal(mock.upsertPayloads[0]?.owner_user_id, "owner-existing");
  assert.equal(mock.upsertPayloads[0]?.access_token_encrypted, "new-access-token");
  assert.equal(mock.upsertPayloads[0]?.refresh_token_encrypted, "new-refresh-token");
});

test("Google Calendar callback token persistence maps database write failure for settings_write_failed", async () => {
  const mock = createCalendarSupabaseMock({
    userId: "owner-failure",
    upsertError: new Error("permission denied for table calendar_integration_settings"),
  });

  const result = await connectGoogleCalendarWithTokens(
    {
      accessToken: "google-access-token",
      refreshToken: "google-refresh-token",
      expiresInSeconds: 3600,
      googleAccountEmail: "owner@example.com",
    },
    {
      supabase: mock.supabase as never,
      updatedAtIso: "2026-05-10T10:00:00.000Z",
    },
  );

  assert.equal(result.errorMessage, "Unable to connect Google Calendar right now.");
  assert.equal(result.data.connected, false);
  assert.equal(mock.upsertPayloads[0]?.owner_user_id, "owner-failure");
});

test("Google Calendar callback token persistence scopes owner from authenticated server session", async () => {
  const mock = createCalendarSupabaseMock({ userId: "authenticated-owner" });

  await connectGoogleCalendarWithTokens(
    {
      accessToken: "google-access-token",
      refreshToken: "google-refresh-token",
      googleAccountEmail: "owner@example.com",
    },
    {
      supabase: mock.supabase as never,
      updatedAtIso: "2026-05-10T10:00:00.000Z",
    },
  );

  assert.equal(mock.upsertPayloads[0]?.owner_user_id, "authenticated-owner");
  assert.equal(
    Object.hasOwn(mock.upsertPayloads[0] ?? {}, "owner_user_id"),
    true,
  );
});

test("Google Calendar callback token persistence requires refresh token", async () => {
  const mock = createCalendarSupabaseMock({ userId: "owner-c" });
  const result = await connectGoogleCalendarWithTokens(
    {
      accessToken: "google-access-token",
      refreshToken: null,
      expiresInSeconds: 3600,
      googleAccountEmail: "owner@example.com",
    },
    {
      supabase: mock.supabase as never,
      updatedAtIso: "2026-05-10T10:00:00.000Z",
    },
  );

  assert.equal(
    result.errorMessage,
    "Google Calendar did not return a refresh token. Reconnect and approve offline Calendar access.",
  );
  assert.equal(result.data.connected, false);
  assert.equal(mock.upsertPayloads.length, 0);
});

test("disconnect clears secrets and disables scheduled task sync", async () => {
  const mock = createCalendarSupabaseMock({ userId: "owner-d" });
  const result = await disconnectGoogleCalendar({
    supabase: mock.supabase as never,
    updatedAtIso: "2026-05-10T10:00:00.000Z",
  });

  assert.equal(result.data.connected, false);
  assert.equal(result.data.scheduledTaskSyncEnabled, false);
  assert.equal(mock.upsertPayloads[0]?.access_token_encrypted, null);
  assert.equal(mock.upsertPayloads[0]?.refresh_token_encrypted, null);
  assert.equal(mock.upsertPayloads[0]?.scheduled_task_sync_enabled, false);
});

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
}) {
  const calls: Array<{ column: string; value: unknown }> = [];
  const selectedColumns: string[] = [];
  const upsertPayloads: Record<string, unknown>[] = [];
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
        upsert(payload: Record<string, unknown>) {
          upsertPayloads.push(payload);
          row = {
            owner_user_id: String(payload.owner_user_id),
            provider: String(payload.provider),
            google_account_email:
              (payload.google_account_email as string | null | undefined) ?? null,
            scheduled_task_sync_enabled: Boolean(
              payload.scheduled_task_sync_enabled,
            ),
            default_reminder_minutes:
              (payload.default_reminder_minutes as number | undefined) ?? 10,
            connected_at:
              (payload.connected_at as string | null | undefined) ?? null,
            disconnected_at:
              (payload.disconnected_at as string | null | undefined) ?? null,
          };

          return {
            select(columns: string) {
              selectedColumns.push(columns);
              return {
                async maybeSingle() {
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
});

test("Google Calendar callback token persistence stores secrets server-side but returns safe view", async () => {
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
  assert.equal(mock.upsertPayloads[0]?.access_token_encrypted, "google-access-token");
  assert.equal(mock.upsertPayloads[0]?.refresh_token_encrypted, "google-refresh-token");
  assert.equal(
    mock.upsertPayloads[0]?.token_expires_at,
    "2026-05-10T11:00:00.000Z",
  );
  assert.equal(assertCalendarSettingsViewHasNoSecrets(result.data), true);
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

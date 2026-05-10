import assert from "node:assert/strict";
import test from "node:test";

import {
  createGoogleCalendarEventForTask,
  googleCalendarClient,
} from "./google-calendar-service";

const connectedCredentials = {
  owner_user_id: "user-1",
  provider: "google",
  google_account_email: "owner@example.com",
  scheduled_task_sync_enabled: true,
  default_reminder_minutes: 15,
  connected_at: "2026-05-10T10:00:00.000Z",
  disconnected_at: null,
  access_token_encrypted: "access-token-1",
  refresh_token_encrypted: "refresh-token-1",
  token_expires_at: "2999-01-01T00:00:00.000Z",
};

test("real Google Calendar adapter posts events.insert request shape", async () => {
  const originalFetch = globalThis.fetch;
  const originalCalendarId = process.env.GOOGLE_CALENDAR_ID;
  const calls: Array<{ url: string; init: RequestInit }> = [];

  process.env.GOOGLE_CALENDAR_ID = "calendar@example.com";
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return Response.json({ id: "google-event-1" });
  }) as typeof fetch;

  try {
    const result = await createGoogleCalendarEventForTask(
      {
        taskId: "task-1",
        title: "Plan deep work slot",
        scheduledStartAt: "2026-05-10T09:00:00.000Z",
        scheduledEndAt: "2026-05-10T10:00:00.000Z",
        calendarSyncEnabled: true,
        calendarReminderMinutes: 20,
      },
      connectedCredentials,
      { client: googleCalendarClient },
    );

    assert.deepEqual(result, {
      status: "synced",
      eventId: "google-event-1",
      failureReason: null,
    });
    assert.equal(
      calls[0]?.url,
      "https://www.googleapis.com/calendar/v3/calendars/calendar%40example.com/events",
    );
    assert.equal(calls[0]?.init.method, "POST");
    assert.equal(
      (calls[0]?.init.headers as Record<string, string>).authorization,
      "Bearer access-token-1",
    );
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
      summary: "Plan deep work slot",
      start: { dateTime: "2026-05-10T09:00:00.000Z" },
      end: { dateTime: "2026-05-10T10:00:00.000Z" },
      reminders: {
        useDefault: false,
        overrides: [{ method: "popup", minutes: 20 }],
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCalendarId === undefined) {
      delete process.env.GOOGLE_CALENDAR_ID;
    } else {
      process.env.GOOGLE_CALENDAR_ID = originalCalendarId;
    }
  }
});

test("real Google Calendar adapter refreshes expired access token before insert", async () => {
  const originalFetch = globalThis.fetch;
  const originalClientId = process.env.GOOGLE_CLIENT_ID;
  const originalClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const calls: Array<{ url: string; init: RequestInit }> = [];

  process.env.GOOGLE_CLIENT_ID = "client-1";
  process.env.GOOGLE_CLIENT_SECRET = "secret-1";
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });

    if (String(url).includes("oauth2.googleapis.com")) {
      return Response.json({ access_token: "fresh-access-token", expires_in: 3600 });
    }

    return Response.json({ id: "google-event-2" });
  }) as typeof fetch;

  try {
    const result = await createGoogleCalendarEventForTask(
      {
        taskId: "task-1",
        title: "Refresh token task",
        scheduledStartAt: "2026-05-10T09:00:00.000Z",
        scheduledEndAt: "2026-05-10T10:00:00.000Z",
        calendarSyncEnabled: true,
        calendarReminderMinutes: 10,
      },
      {
        ...connectedCredentials,
        access_token_encrypted: "expired-token",
        token_expires_at: "2020-01-01T00:00:00.000Z",
      },
      { client: googleCalendarClient },
    );

    assert.equal(result.status, "synced");
    assert.equal(calls[0]?.url, "https://oauth2.googleapis.com/token");
    assert.equal(
      (calls[1]?.init.headers as Record<string, string>).authorization,
      "Bearer fresh-access-token",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalClientId === undefined) {
      delete process.env.GOOGLE_CLIENT_ID;
    } else {
      process.env.GOOGLE_CLIENT_ID = originalClientId;
    }
    if (originalClientSecret === undefined) {
      delete process.env.GOOGLE_CLIENT_SECRET;
    } else {
      process.env.GOOGLE_CLIENT_SECRET = originalClientSecret;
    }
  }
});

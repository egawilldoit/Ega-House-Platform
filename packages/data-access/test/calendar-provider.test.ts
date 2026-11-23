import assert from "node:assert/strict";
import test from "node:test";

import type {
  CalendarConnectionRecord,
  CalendarEventPayload,
} from "@ega/application/calendar-sync/ports";

import { GoogleCalendarEventProvider } from "../src/calendar/google-calendar-provider";

const connection: CalendarConnectionRecord = {
  ownerUserId: "owner-1",
  provider: "google",
  accountSubject: "google-subject-1",
  accountEmail: "owner@example.com",
  calendarId: "primary",
  destinationKey: "google-subject-1|primary",
  accessTokenEncrypted: "enc-access",
  refreshTokenEncrypted: "enc-refresh",
  tokenExpiresAt: "2999-01-01T00:00:00.000Z",
  connectedAt: "2026-05-01T00:00:00.000Z",
  disconnectedAt: null,
  reconnectRequiredAt: null,
  updatedAt: "2026-05-01T00:00:00.000Z",
};

function providerWith(
  fetchImpl: typeof fetch,
  now = () => new Date("2026-05-10T08:00:00.000Z"),
) {
  return new GoogleCalendarEventProvider({
    decryptToken: (value) => (value ? String(value).replace(/^enc-/, "") : null),
    encryptToken: (value) => `enc-${value}`,
    clientId: "client-1",
    clientSecret: "secret-1",
    fetchImpl,
    now,
    requestTimeoutMs: 2_000,
  });
}

test("managed event listing pages through every page, including empty pages with a token", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    const parsed = new URL(String(url));
    calls.push(parsed.toString());
    assert.equal(
      parsed.searchParams.get("privateExtendedProperty"),
      "source=ega-house",
    );
    assert.equal(parsed.searchParams.get("showDeleted"), "false");
    assert.equal(
      parsed.searchParams.get("fields"),
      "items(id,status,extendedProperties),nextPageToken",
    );

    if (!parsed.searchParams.get("pageToken")) {
      return Response.json({
        items: [
          {
            id: "event-1",
            status: "confirmed",
            extendedProperties: {
              private: {
                source: "ega-house",
                task_id: "task-1",
                owner_user_id: "owner-1",
                destination_key: "google-subject-1|primary",
                generation: "1",
                payload_hash: "hash-1",
              },
            },
          },
        ],
        nextPageToken: "page-2",
      });
    }

    if (parsed.searchParams.get("pageToken") === "page-2") {
      return Response.json({
        items: [],
        nextPageToken: "page-3",
      });
    }

    return Response.json({
      items: [
        {
          id: "event-2",
          status: "confirmed",
          extendedProperties: {
            private: { source: "ega-house", task_id: "task-2" },
          },
        },
      ],
    });
  }) as typeof fetch;

  const result = await providerWith(fetchImpl).listManagedEvents(connection);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.complete, true);
  assert.deepEqual(
    result.value.events.map((event) => event.id),
    ["event-1", "event-2"],
  );
  assert.equal(calls.length, 3);
  assert.equal(result.value.events[0]?.generation, 1);
  assert.equal(result.value.events[0]?.payloadHash, "hash-1");
});

test("expired access token refreshes once per batch and keeps the stored refresh token", async () => {
  let tokenCalls = 0;
  const fetchImpl = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const parsed = new URL(String(url));
    if (parsed.hostname === "oauth2.googleapis.com") {
      tokenCalls += 1;
      return Response.json({
        access_token: "fresh-access",
        expires_in: 3600,
      });
    }

    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer fresh-access",
    );
    return Response.json({ items: [] });
  }) as typeof fetch;

  const provider = providerWith(fetchImpl);
  const expired = {
    ...connection,
    tokenExpiresAt: "2020-01-01T00:00:00.000Z",
  };

  const first = await provider.listManagedEvents(expired);
  const second = await provider.listManagedEvents(expired);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(tokenCalls, 1);
  if (!first.ok) return;
  assert.equal(
    first.refreshedCredentials?.accessTokenEncrypted,
    "enc-fresh-access",
  );
  assert.equal(
    "refreshTokenEncrypted" in (first.refreshedCredentials ?? {}),
    false,
  );
});

test("revoked refresh token is reported as an authorization failure", async () => {
  const fetchImpl = (async (url: string | URL | Request) => {
    const parsed = new URL(String(url));
    if (parsed.hostname === "oauth2.googleapis.com") {
      return Response.json(
        { error: "invalid_grant", error_description: "Token has been revoked." },
        { status: 400 },
      );
    }
    return Response.json({ items: [] });
  }) as typeof fetch;

  const result = await providerWith(fetchImpl).listManagedEvents({
    ...connection,
    tokenExpiresAt: "2020-01-01T00:00:00.000Z",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "authorization");
});

test("create sends deterministic id, private source metadata, and reminder", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return Response.json({
      id: "ega-event-1",
      status: "confirmed",
      summary: "Plan",
      start: { dateTime: "2026-05-10T09:00:00.000Z" },
      end: { dateTime: "2026-05-10T10:00:00.000Z" },
      extendedProperties: {
        private: { source: "ega-house", task_id: "task-1" },
      },
    });
  }) as typeof fetch;

  const payload: CalendarEventPayload = {
    eventId: "ega-event-1",
    summary: "Plan",
    description: "Open in EGA House: https://ega.example/tasks?task=task-1",
    start: { dateTime: "2026-05-10T09:00:00.000Z" },
    end: { dateTime: "2026-05-10T10:00:00.000Z" },
    reminderMinutes: 15,
    privateProperties: {
      source: "ega-house",
      task_id: "task-1",
      owner_user_id: "owner-1",
      destination_key: "google-subject-1|primary",
      generation: "1",
      payload_hash: "hash-1",
    },
  };

  const result = await providerWith(fetchImpl).createEvent(connection, payload);
  assert.equal(result.ok, true);
  assert.equal(
    calls[0]?.url,
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
  );
  assert.equal(calls[0]?.init.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    id: "ega-event-1",
    summary: "Plan",
    description: "Open in EGA House: https://ega.example/tasks?task=task-1",
    start: { dateTime: "2026-05-10T09:00:00.000Z" },
    end: { dateTime: "2026-05-10T10:00:00.000Z" },
    reminders: {
      useDefault: false,
      overrides: [{ method: "popup", minutes: 15 }],
    },
    extendedProperties: { private: payload.privateProperties },
  });
});

test("rate limit with Retry-After remains retryable", async () => {
  const fetchImpl = (async () =>
    Response.json(
      {
        error: {
          message: "Rate limit exceeded",
          errors: [{ reason: "rateLimitExceeded" }],
        },
      },
      { status: 429, headers: { "retry-after": "30" } },
    )) as typeof fetch;

  const result = await providerWith(fetchImpl).createEvent(connection, {
    eventId: "ega-event-1",
    summary: "Plan",
    description: "",
    start: { dateTime: "2026-05-10T09:00:00.000Z" },
    end: { dateTime: "2026-05-10T10:00:00.000Z" },
    reminderMinutes: 10,
    privateProperties: { source: "ega-house" },
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "retryable");
  assert.equal(result.error.retryAfterSeconds, 30);
});

test("deleting an already removed event is a successful removal", async () => {
  const fetchImpl = (async () =>
    new Response(null, { status: 410 })) as typeof fetch;

  const result = await providerWith(fetchImpl).deleteEvent(
    connection,
    "ega-event-1",
  );

  assert.deepEqual(result, {
    ok: true,
    value: { alreadyRemoved: true },
    refreshedCredentials: undefined,
  });
});

test("a reconnect for the same owner does not reuse the previous account's access token", async () => {
  const authorizations: string[] = [];
  const fetchImpl = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const parsed = new URL(String(url));
    if (parsed.hostname === "oauth2.googleapis.com") {
      throw new Error("unexpected token refresh");
    }
    authorizations.push(
      new Headers(init?.headers).get("authorization") ?? "",
    );
    return Response.json({ items: [] });
  }) as typeof fetch;

  const provider = providerWith(fetchImpl);
  const first = await provider.listManagedEvents(connection);
  const second = await provider.listManagedEvents({
    ...connection,
    accountSubject: "google-subject-2",
    accountEmail: "new@example.com",
    destinationKey: "new@example.com|primary",
    accessTokenEncrypted: "enc-access-b",
    updatedAt: "2026-05-11T00:00:00.000Z",
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(authorizations, ["Bearer access", "Bearer access-b"]);
});

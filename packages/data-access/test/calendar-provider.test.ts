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

test("a successful listing with an unreadable body is rejected, not treated as empty", async () => {
  const fetchImpl = (async () =>
    new Response("{not-json", {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  const result = await providerWith(fetchImpl).listManagedEvents(connection);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "retryable");
  assert.match(result.error.message, /unreadable event listing/i);
});

test("a listing page with an invalid item or page-token shape is rejected", async () => {
  const malformedPages = [
    { items: { id: "event-1" } },
    { items: [{ status: "confirmed" }] },
    { items: [{ id: "event-1", status: 7 }] },
    {
      items: [
        {
          id: "event-1",
          extendedProperties: { private: { source: 7 } },
        },
      ],
    },
    { items: [], nextPageToken: 42 },
    { items: [], nextPageToken: "   " },
    { error: { message: "quota exceeded" } },
  ];

  for (const payload of malformedPages) {
    const result = await providerWith(
      (async () => Response.json(payload)) as typeof fetch,
    ).listManagedEvents(connection);
    assert.equal(result.ok, false, JSON.stringify(payload));
    if (result.ok) continue;
    assert.equal(result.error.kind, "retryable", JSON.stringify(payload));
  }
});

test("event lookup reports 404 as confirmed absence", async () => {
  const fetchImpl = (async () =>
    new Response(null, { status: 404 })) as typeof fetch;

  const result = await providerWith(fetchImpl).getEvent(
    connection,
    "ega-event-1",
  );
  assert.deepEqual(result, {
    ok: true,
    value: null,
    refreshedCredentials: undefined,
  });
});

test("event lookup rejects an unreadable or mismatched body instead of reporting absence", async () => {
  const responses = [
    async () =>
      new Response("{not-json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    async () => Response.json({ id: "some-other-event", status: "confirmed" }),
    async () =>
      Response.json({
        id: "ega-event-1",
        status: "confirmed",
        extendedProperties: { private: { source: 7 } },
      }),
  ];

  for (const respond of responses) {
    const result = await providerWith(respond as typeof fetch).getEvent(
      connection,
      "ega-event-1",
    );
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.equal(result.error.kind, "retryable");
    assert.match(result.error.message, /unreadable event lookup/i);
  }
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
      start: { dateTime: "2026-05-10T10:00:00+01:00" },
      end: { dateTime: "2026-05-10T10:00:00Z" },
      extendedProperties: {
        private: { source: "ega-house", task_id: "task-1" },
      },
    });
  }) as typeof fetch;

  const payload: CalendarEventPayload = {
    eventId: "ega-event-1",
    summary: "Plan",
    description: "Open in EGA House: https://ega.example/tasks?task=task-1",
    start: { dateTime: "2026-05-10T09:00:00.000Z", timeZone: "Europe/London" },
    end: { dateTime: "2026-05-10T10:00:00.000Z", timeZone: "Europe/London" },
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
    start: { dateTime: "2026-05-10T09:00:00.000Z", timeZone: "Europe/London" },
    end: { dateTime: "2026-05-10T10:00:00.000Z", timeZone: "Europe/London" },
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

test("PATCH clears opposite boundary fields and rejects mixed responses", async () => {
  const allDay = { date: "2026-05-10" };
  const timed = { dateTime: "2026-05-10T09:00:00.000Z", timeZone: "Europe/London" };
  const common = {
    eventId: "ega-event-1",
    summary: "Plan",
    description: "",
    reminderMinutes: 10,
    privateProperties: { source: "ega-house" },
  };
  const cases = [
    { boundary: allDay, patch: { ...allDay, dateTime: null, timeZone: null }, old: timed },
    { boundary: timed, patch: { ...timed, date: null }, old: allDay },
  ];
  for (const { boundary, patch, old } of cases) {
    for (const keepOldBoundary of [false, true]) {
      const provider = providerWith(async (_url, init) => {
        assert.equal(init?.method, "PATCH");
        assert.deepEqual(JSON.parse(String(init?.body)).start, patch);
        assert.deepEqual(JSON.parse(String(init?.body)).end, patch);
        return Response.json({
          id: common.eventId,
          start: keepOldBoundary ? { ...old, ...boundary } : boundary,
          end: boundary,
          extendedProperties: { private: common.privateProperties },
        });
      });
      const result = await provider.updateEvent(connection, common.eventId, {
        ...common,
        start: boundary,
        end: boundary,
      });
      assert.equal(result.ok, !keepOldBoundary);
    }
  }
});

test("Calendar GET and create transport errors are retryable results", async () => {
  const provider = providerWith(async (_url, request) => {
    if (request?.method === "POST") throw new TypeError("network unavailable");
    throw new DOMException("timeout", "TimeoutError");
  });
  const payload: CalendarEventPayload = {
    eventId: "planned-event",
    summary: "Task",
    description: "",
    start: { date: "2026-05-10" },
    end: { date: "2026-05-11" },
    reminderMinutes: 10,
    privateProperties: {},
  };

  for (const result of [
    await provider.getEvent(connection, payload.eventId),
    await provider.createEvent(connection, payload),
  ]) {
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.error.kind, "retryable");
  }
});

test("a timed-out token refresh can be retried on the same provider", async () => {
  let refreshAttempts = 0;
  const provider = providerWith(async (url, request) => {
    if (String(url) === "https://oauth2.googleapis.com/token") {
      assert.ok(request?.signal);
      refreshAttempts += 1;
      if (refreshAttempts === 1) throw new DOMException("timeout", "TimeoutError");
      return Response.json({ access_token: "refreshed", expires_in: 3600 });
    }
    return new Response(null, { status: 404 });
  });
  const expired = { ...connection, tokenExpiresAt: "2026-05-09T00:00:00.000Z" };

  const first = await provider.getEvent(expired, "event-1");
  assert.equal(!first.ok && first.error.kind, "retryable");

  const second = await provider.getEvent(expired, "event-1");
  assert.ok(second.ok);
  assert.equal(second.value, null);
  assert.equal(refreshAttempts, 2);
});

test("a network error on the 401 retry remains retryable", async () => {
  let calendarRequests = 0;
  const provider = providerWith(async (url) => {
    if (String(url) === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "refreshed", expires_in: 3600 });
    }
    calendarRequests += 1;
    if (calendarRequests === 1) return new Response(null, { status: 401 });
    throw new TypeError("network unavailable");
  });

  const result = await provider.getEvent(connection, "event-1");
  assert.equal(!result.ok && result.error.kind, "retryable");
  assert.equal(calendarRequests, 2);
});

test("post-header body read timeouts are retryable for refresh, create, and update", async () => {
  const abortingOkResponse = () =>
    ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => {
        throw new DOMException("body read timeout", "TimeoutError");
      },
    }) as unknown as Response;

  const payload: CalendarEventPayload = {
    eventId: "planned-event",
    summary: "Task",
    description: "",
    start: { date: "2026-05-10" },
    end: { date: "2026-05-11" },
    reminderMinutes: 10,
    privateProperties: { source: "ega-house" },
  };

  const refreshProvider = providerWith(async () => abortingOkResponse());
  const expired = { ...connection, tokenExpiresAt: "2026-05-09T00:00:00.000Z" };
  const refreshResult = await refreshProvider.getEvent(expired, "event-1");
  assert.equal(refreshResult.ok, false);
  assert.equal(!refreshResult.ok && refreshResult.error.kind, "retryable");

  const writeProvider = providerWith(async () => abortingOkResponse());
  const createResult = await writeProvider.createEvent(connection, payload);
  assert.equal(createResult.ok, false);
  assert.equal(!createResult.ok && createResult.error.kind, "retryable");

  const updateResult = await writeProvider.updateEvent(
    connection,
    payload.eventId,
    payload,
  );
  assert.equal(updateResult.ok, false);
  assert.equal(!updateResult.ok && updateResult.error.kind, "retryable");
});

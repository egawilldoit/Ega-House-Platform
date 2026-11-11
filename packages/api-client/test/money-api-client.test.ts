import assert from "node:assert/strict";
import test from "node:test";

import { createEgaApiClient } from "../src/client";

type CapturedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
};

function makeHarness(status = 200, body: unknown = {}) {
  const calls: CapturedRequest[] = [];
  const fetch = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ) => {
    calls.push({
      url,
      method: init.method,
      headers: init.headers,
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  const client = createEgaApiClient({
    baseUrl: "https://api.ega.example/",
    getAccessToken: () => "token-money",
    fetch: fetch as never,
  });
  return { client, calls };
}

const PERIOD = {
  id: "00000000-0000-4000-8000-000000000001",
  startDate: "2026-11-09",
  endDate: "2026-11-30",
  currency: "MAD",
  timezone: "Africa/Casablanca",
  activeDate: "2026-11-11",
  lifecycle: "tracking",
  initialization: "initialized",
  openingMovementId: "00000000-0000-4000-8000-000000000002",
  provenance: {
    opening: {
      source: "user_entered",
      recordedAt: "2026-11-11T10:00:00.000Z",
      cutoffDate: "2026-11-08",
      evidence: null,
      note: null,
      corrections: [],
    },
    createdFrom: "web",
  },
  settings: {},
  version: 2,
  createdAt: "2026-11-11T10:00:00.000Z",
  updatedAt: "2026-11-11T10:00:00.000Z",
};

const MOVEMENT = {
  id: "00000000-0000-4000-8000-000000000010",
  kind: "income",
  direction: "in",
  amountMinor: 20000,
  currency: "MAD",
  category: null,
  note: "salary",
  merchant: null,
  needVsWant: null,
  paymentMethod: null,
  purpose: null,
  countsInDaily: false,
  bookingDate: "2026-11-09",
  occurredAt: null,
  periodId: null,
  version: 1,
  deletedAt: null,
  createdAt: "2026-11-09T10:00:00.000Z",
  updatedAt: "2026-11-09T10:00:00.000Z",
};

test("state maps GET /api/money/state with explicit query options and auth", async () => {
  const response = {
    ok: true,
    localToday: "2026-11-11",
    timezone: "Africa/Casablanca",
    period: PERIOD,
    opening: {
      status: "known",
      amountMinor: 50000,
      currency: "MAD",
      bookingDate: "2026-11-09",
      version: 1,
      openingMovementId: PERIOD.openingMovementId,
    },
    cash: { available: false, currency: "MAD", reason: "pending", cutoffDate: "2026-11-11" },
    dateResolution: {
      localToday: "2026-11-11",
      timezone: "Africa/Casablanca",
      activeDate: "2026-11-11",
      periodTimezone: "Africa/Casablanca",
      datesDiffer: false,
      requestedDate: "2026-11-11",
      requestedMode: null,
      resolvedDate: "2026-11-11",
      basis: "explicit_date",
      periodRelation: "in_period",
    },
    history: [],
    historyUnavailable: false,
    legacy: {
      available: true,
      totalExpenseCount: 0,
      assignedToPeriodCount: 0,
      inPeriodUnassignedCount: 0,
      bookingDateAssignment: "derived_from_occurred_at_in_owner_timezone",
      reviewRequired: false,
    },
  };
  const { client, calls } = makeHarness(200, response);
  const result = await client.money.state({
    periodId: PERIOD.id,
    date: "2026-11-11",
  });

  assert.deepEqual(result, { ok: true, data: response });
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/api/money/state");
  assert.equal(url.searchParams.get("periodId"), PERIOD.id);
  assert.equal(url.searchParams.get("date"), "2026-11-11");
  assert.equal(calls[0].headers.Authorization, "Bearer token-money");
  assert.equal(calls[0].method, "GET");
});

test("state omits blank filters", async () => {
  const { client, calls } = makeHarness(200, { ok: true });
  await client.money.state({ periodId: "  ", date: null, mode: null });
  assert.equal(new URL(calls[0].url).search, "");
});

test("createPeriod posts the canonical body", async () => {
  const response = { ok: true, period: PERIOD, replayed: false };
  const { client, calls } = makeHarness(201, response);
  const request = {
    startDate: "2026-11-09",
    endDate: "2026-11-30",
    timezone: "Africa/Casablanca",
    activeDate: "2026-11-11",
    opening: {
      amountMinor: 50000,
      source: "user_entered" as const,
      cutoffDate: "2026-11-08",
      note: "counted",
    },
    settings: { dailyTargetMinor: 20000 },
  };
  const result = await client.money.createPeriod(request);

  assert.deepEqual(result, { ok: true, data: response });
  assert.equal(calls[0].url, "https://api.ega.example/api/money/periods");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, request);
});

test("updateSettings targets the encoded period settings path with the version", async () => {
  const response = { ok: true, period: PERIOD };
  const { client, calls } = makeHarness(200, response);
  await client.money.updateSettings(PERIOD.id, {
    version: 2,
    activeDate: "2026-11-10",
  });

  assert.deepEqual(
    calls.map((call) => `${call.method} ${new URL(call.url).pathname}`),
    [`PATCH /api/money/periods/${PERIOD.id}/settings`],
  );
  assert.deepEqual(calls[0].body, { version: 2, activeDate: "2026-11-10" });
});

test("a stale-version 409 remains a typed conflict", async () => {
  const { client } = makeHarness(409, {
    error: { code: "CONFLICT", message: "The period changed." },
  });
  const result = await client.money.updateSettings(PERIOD.id, {
    version: 1,
    activeDate: "2026-11-10",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "CONFLICT");
    assert.equal(result.error.status, 409);
  }
});

test("listMovements maps GET /api/money/movements with bounded query options", async () => {
  const response = {
    ok: true,
    movements: [MOVEMENT],
    pagination: { limit: 10, offset: 0, hasMore: false },
    cutoff: "2026-11-10",
    timezone: "Africa/Casablanca",
  };
  const { client, calls } = makeHarness(200, response);
  const result = await client.money.listMovements({
    from: "2026-11-01",
    to: "2026-11-10",
    cutoff: "2026-11-10",
    timezone: "Africa/Casablanca",
    kind: "income",
    limit: 10,
  });

  assert.deepEqual(result, { ok: true, data: response });
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/api/money/movements");
  assert.equal(url.searchParams.get("from"), "2026-11-01");
  assert.equal(url.searchParams.get("cutoff"), "2026-11-10");
  assert.equal(url.searchParams.get("kind"), "income");
  assert.equal(calls[0].headers.Authorization, "Bearer token-money");
});

test("createMovement posts the canonical body and returns the stored movement", async () => {
  const response = { ok: true, movement: MOVEMENT, replayed: false };
  const { client, calls } = makeHarness(201, response);
  const request = {
    kind: "income" as const,
    amountMinor: 20000,
    bookingDate: "2026-11-09",
    note: "salary",
    idempotencyKey: "income-1",
  };
  const result = await client.money.createMovement(request);

  assert.deepEqual(result, { ok: true, data: response });
  assert.equal(calls[0].url, "https://api.ega.example/api/money/movements");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, request);
});

test("getMovement and updateMovement target the documented movement paths", async () => {
  const { client, calls } = makeHarness(200, { ok: true, movement: MOVEMENT });
  await client.money.getMovement(MOVEMENT.id);
  await client.money.updateMovement(MOVEMENT.id, { version: 1, amountMinor: 21000 });

  assert.deepEqual(
    calls.map((call) => `${call.method} ${new URL(call.url).pathname}`),
    [
      `GET /api/money/movements/${MOVEMENT.id}`,
      `PATCH /api/money/movements/${MOVEMENT.id}`,
    ],
  );
  assert.deepEqual(calls[1].body, { version: 1, amountMinor: 21000 });
});

test("a 403 FORBIDDEN money envelope remains a typed forbidden error", async () => {
  const { client } = makeHarness(403, {
    error: { code: "FORBIDDEN", message: "You do not have permission." },
  });
  const result = await client.money.createMovement({
    kind: "savings_transfer",
    amountMinor: 50000,
    bookingDate: "2026-11-10",
    idempotencyKey: "save-1",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "FORBIDDEN");
    assert.equal(result.error.status, 403);
  }
});

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
    getAccessToken: () => "token-abc",
    fetch: fetch as never,
  });
  return { client, calls };
}

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
  assert.equal(calls[0].headers.Authorization, "Bearer token-abc");
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

test("getMovement, updateMovement and getState target the documented paths", async () => {
  const { client, calls } = makeHarness(200, { ok: true, movement: MOVEMENT });
  await client.money.getMovement(MOVEMENT.id);
  await client.money.updateMovement(MOVEMENT.id, { version: 1, amountMinor: 21000 });
  await client.money.getState({ cutoff: "2026-11-11", timezone: "Africa/Casablanca" });

  assert.deepEqual(
    calls.map((call) => `${call.method} ${new URL(call.url).pathname}`),
    [
      `GET /api/money/movements/${MOVEMENT.id}`,
      `PATCH /api/money/movements/${MOVEMENT.id}`,
      "GET /api/money/state",
    ],
  );
  assert.deepEqual(calls[1].body, { version: 1, amountMinor: 21000 });
  const stateQuery = new URL(calls[2].url);
  assert.equal(stateQuery.searchParams.get("cutoff"), "2026-11-11");
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

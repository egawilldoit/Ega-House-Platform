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

const EXPENSE = {
  id: "00000000-0000-4000-8000-000000000001",
  occurredAt: "2026-11-07T08:30:00.000Z",
  amountMinor: 2250,
  currency: "MAD",
  category: "coffee",
  note: null,
  merchant: null,
  needVsWant: "want",
  paymentMethod: "card",
  idempotencyKey: "key-1",
  version: 1,
  deletedAt: null,
  createdAt: "2026-11-07T08:31:00.000Z",
  updatedAt: "2026-11-07T08:31:00.000Z",
};

test("list maps GET /api/expenses with bounded query options and auth", async () => {
  const response = {
    ok: true,
    expenses: [EXPENSE],
    pagination: { limit: 10, offset: 20, hasMore: false },
  };
  const { client, calls } = makeHarness(200, response);
  const result = await client.expenses.list({
    from: "2026-11-01",
    to: "2026-11-07",
    timezone: "Africa/Casablanca",
    limit: 10,
    offset: 20,
  });

  assert.deepEqual(result, { ok: true, data: response });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/api/expenses");
  assert.equal(url.searchParams.get("from"), "2026-11-01");
  assert.equal(url.searchParams.get("to"), "2026-11-07");
  assert.equal(url.searchParams.get("timezone"), "Africa/Casablanca");
  assert.equal(url.searchParams.get("limit"), "10");
  assert.equal(url.searchParams.get("offset"), "20");
  assert.equal(calls[0].headers.Authorization, "Bearer token-abc");
  assert.equal(calls[0].method, "GET");
});

test("list omits blank and absent options", async () => {
  const { client, calls } = makeHarness(200, {
    ok: true,
    expenses: [],
    pagination: { limit: 50, offset: 0, hasMore: false },
  });
  await client.expenses.list({ from: "  ", to: null, timezone: null });
  assert.equal(new URL(calls[0].url).search, "");
});

test("create posts the canonical body and returns the replay receipt", async () => {
  const response = { ok: true, expense: EXPENSE, replayed: true };
  const { client, calls } = makeHarness(200, response);
  const request = {
    occurredAt: EXPENSE.occurredAt,
    amountMinor: EXPENSE.amountMinor,
    category: "coffee" as const,
    needVsWant: "want" as const,
    paymentMethod: "card" as const,
    idempotencyKey: "key-1",
  };
  const result = await client.expenses.create(request);

  assert.deepEqual(result, { ok: true, data: response });
  assert.equal(calls[0].url, "https://api.ega.example/api/expenses");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, request);
});

test("get, update and remove target the encoded expense path", async () => {
  const { client, calls } = makeHarness(200, { ok: true, expense: EXPENSE });
  await client.expenses.get(EXPENSE.id);
  await client.expenses.update(EXPENSE.id, { version: 2, amountMinor: 1990 });
  await client.expenses.remove(EXPENSE.id);

  assert.deepEqual(
    calls.map((call) => `${call.method} ${new URL(call.url).pathname}`),
    [
      `GET /api/expenses/${EXPENSE.id}`,
      `PATCH /api/expenses/${EXPENSE.id}`,
      `DELETE /api/expenses/${EXPENSE.id}`,
    ],
  );
  assert.deepEqual(calls[1].body, { version: 2, amountMinor: 1990 });
});

test("the standard error envelope is preserved as a typed conflict", async () => {
  const { client } = makeHarness(409, {
    error: { code: "CONFLICT", message: "That idempotency key was already used." },
  });
  const result = await client.expenses.create({
    occurredAt: EXPENSE.occurredAt,
    amountMinor: 2250,
    category: "coffee",
    needVsWant: "want",
    idempotencyKey: "key-1",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "CONFLICT");
    assert.equal(result.error.status, 409);
  }
});

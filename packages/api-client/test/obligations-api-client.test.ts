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

const OCCURRENCE = {
  id: "22222222-2222-4222-8222-222222222222",
  kind: "bill",
  description: "Rent",
  amountMinor: 350000,
  currency: "MAD",
  periodStart: "2026-11-01",
  periodEnd: "2026-11-30",
  dueDate: "2026-11-05",
  needVsWant: null,
  purpose: "fixed",
  countsInDaily: false,
  category: "bills",
  state: "pending",
  stateEffectiveDate: "2026-11-01",
  stateReason: null,
  paymentExpenseId: null,
  paymentEvidence: null,
  templateId: null,
  idempotencyKey: "occurrence-1",
  version: 1,
  createdAt: "2026-11-01T09:00:00.000Z",
  updatedAt: "2026-11-01T09:00:00.000Z",
};

const TEMPLATE = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "subscription",
  description: "Streaming",
  amountMinor: 4900,
  currency: "MAD",
  cadence: "monthly",
  dueDayOfMonth: 20,
  dueWeekday: null,
  startDate: "2026-11-01",
  endDate: null,
  needVsWant: null,
  purpose: null,
  countsInDaily: null,
  category: null,
  lifecycle: "active",
  idempotencyKey: "template-1",
  version: 1,
  createdAt: "2026-11-01T09:00:00.000Z",
  updatedAt: "2026-11-01T09:00:00.000Z",
};

test("list maps GET /api/money/obligations with kind/state/due bounds", async () => {
  const response = {
    ok: true,
    obligations: [OCCURRENCE],
    pagination: { limit: 25, offset: 0, hasMore: false },
  };
  const { client, calls } = makeHarness(200, response);
  const result = await client.obligations.list({
    kind: "bill",
    state: "pending",
    dueFrom: "2026-11-01",
    dueTo: "2026-11-30",
    limit: 25,
  });

  assert.deepEqual(result, { ok: true, data: response });
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/api/money/obligations");
  assert.equal(url.searchParams.get("kind"), "bill");
  assert.equal(url.searchParams.get("state"), "pending");
  assert.equal(url.searchParams.get("dueFrom"), "2026-11-01");
  assert.equal(url.searchParams.get("dueTo"), "2026-11-30");
  assert.equal(url.searchParams.get("limit"), "25");
  assert.equal(calls[0].headers.Authorization, "Bearer token-abc");
  assert.equal(calls[0].method, "GET");
});

test("list omits blank optional filters", async () => {
  const { client, calls } = makeHarness(200, {
    ok: true,
    obligations: [],
    pagination: { limit: 50, offset: 0, hasMore: false },
  });
  await client.obligations.list({ kind: null, state: null, dueFrom: "  " });
  assert.equal(new URL(calls[0].url).search, "");
});

test("summary requests the cutoff and kind from the summary path", async () => {
  const response = {
    ok: true,
    summary: {
      currency: "MAD",
      cutoffDate: "2026-11-11",
      dueMinor: 0,
      overdueMinor: 0,
      outstandingMinor: 0,
      paidMinor: 0,
      pendingCount: 0,
      overdueCount: 0,
      paidCount: 0,
      waivedCount: 0,
      cancelledCount: 0,
      occurrenceCount: 0,
      truncated: false,
    },
  };
  const { client, calls } = makeHarness(200, response);
  const result = await client.obligations.summary({
    cutoff: "2026-11-11",
    kind: "subscription",
  });
  assert.deepEqual(result, { ok: true, data: response });
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/api/money/obligations/summary");
  assert.equal(url.searchParams.get("cutoff"), "2026-11-11");
  assert.equal(url.searchParams.get("kind"), "subscription");
});

test("create posts the occurrence body and returns the replay receipt", async () => {
  const response = { ok: true, obligation: OCCURRENCE, replayed: false };
  const { client, calls } = makeHarness(201, response);
  const request = {
    kind: "bill" as const,
    description: "Rent",
    amountMinor: 350000,
    dueDate: "2026-11-05",
    periodStart: "2026-11-01",
    periodEnd: "2026-11-30",
    stateEffectiveDate: "2026-11-01",
    idempotencyKey: "occurrence-1",
  };
  const result = await client.obligations.create(request);

  assert.deepEqual(result, { ok: true, data: response });
  assert.equal(calls[0].url, "https://api.ega.example/api/money/obligations");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, request);
});

test("get, update and transition target the same occurrence id", async () => {
  const { client, calls } = makeHarness(200, {
    ok: true,
    obligation: OCCURRENCE,
  });
  await client.obligations.get(OCCURRENCE.id);
  await client.obligations.update(OCCURRENCE.id, {
    version: 1,
    amountMinor: 360000,
  });
  await client.obligations.transition(OCCURRENCE.id, {
    version: 1,
    to: "waived",
    effectiveDate: "2026-11-11",
    reason: "Waived",
  });

  assert.deepEqual(
    calls.map((call) => `${call.method} ${new URL(call.url).pathname}`),
    [
      `GET /api/money/obligations/${OCCURRENCE.id}`,
      `PATCH /api/money/obligations/${OCCURRENCE.id}`,
      `POST /api/money/obligations/${OCCURRENCE.id}/transition`,
    ],
  );
  assert.deepEqual(calls[2].body, {
    version: 1,
    to: "waived",
    effectiveDate: "2026-11-11",
    reason: "Waived",
  });
});

test("template endpoints cover list, create, get, update and generate", async () => {
  const { client, calls } = makeHarness(200, {
    ok: true,
    template: TEMPLATE,
  });
  await client.obligations.listTemplates({ kind: "subscription", includeArchived: true });
  await client.obligations.createTemplate({
    kind: "subscription",
    description: "Streaming",
    amountMinor: 4900,
    cadence: "monthly",
    dueDayOfMonth: 20,
    startDate: "2026-11-01",
    idempotencyKey: "template-1",
  });
  await client.obligations.getTemplate(TEMPLATE.id);
  await client.obligations.updateTemplate(TEMPLATE.id, {
    version: 1,
    lifecycle: "archived",
  });
  await client.obligations.generate(TEMPLATE.id, { throughDate: "2026-12-31" });

  assert.deepEqual(
    calls.map((call) => `${call.method} ${new URL(call.url).pathname}`),
    [
      "GET /api/money/obligation-templates",
      "POST /api/money/obligation-templates",
      `GET /api/money/obligation-templates/${TEMPLATE.id}`,
      `PATCH /api/money/obligation-templates/${TEMPLATE.id}`,
      `POST /api/money/obligation-templates/${TEMPLATE.id}/generate`,
    ],
  );
  const listUrl = new URL(calls[0].url);
  assert.equal(listUrl.searchParams.get("kind"), "subscription");
  assert.equal(listUrl.searchParams.get("includeArchived"), "true");
  assert.deepEqual(calls[4].body, { throughDate: "2026-12-31" });
});

test("a 409 CONFLICT from the obligation route stays typed", async () => {
  const { client } = makeHarness(409, {
    error: {
      code: "CONFLICT",
      message: "Paying an obligation requires the atomic MONEY-07 payment path.",
    },
  });
  const result = await client.obligations.transition(OCCURRENCE.id, {
    version: 1,
    to: "paid",
    effectiveDate: "2026-11-11",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "CONFLICT");
    assert.equal(result.error.status, 409);
  }
});

test("a 403 FORBIDDEN from the template route stays typed", async () => {
  const { client } = makeHarness(403, {
    error: { code: "FORBIDDEN", message: "You do not have permission." },
  });
  const result = await client.obligations.createTemplate({
    kind: "bill",
    description: "Rent",
    amountMinor: 1000,
    cadence: "monthly",
    dueDayOfMonth: 1,
    startDate: "2026-11-01",
    idempotencyKey: "template-1",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "FORBIDDEN");
});

test("the payment, correction and undo target the same occurrence", async () => {
  const response = {
    ok: true,
    obligation: { ...OCCURRENCE, state: "paid" },
    payment: {
      expenseId: "33333333-3333-4333-8333-333333333333",
      amountMinor: 350000,
      currency: "MAD",
      bookingDate: "2026-11-05",
      countsInDaily: false,
      needVsWant: "need",
      paymentMethod: "cash",
      purpose: "fixed",
      category: "bills",
    },
    replayed: false,
  };
  const { client, calls } = makeHarness(201, response);

  const paid = await client.obligations.pay(OCCURRENCE.id, {
    version: 1,
    bookingDate: "2026-11-05",
    idempotencyKey: "obligation-payment:op-1",
    needVsWant: "need",
    operationId: "op-1",
  });
  assert.deepEqual(paid, { ok: true, data: response });

  await client.obligations.correctPayment(OCCURRENCE.id, {
    version: 2,
    amountMinor: 355000,
    bookingDate: "2026-11-06",
    operationId: "op-2",
  });
  await client.obligations.undoPayment(OCCURRENCE.id, {
    version: 3,
    operationId: "op-3",
  });

  assert.deepEqual(
    calls.map((call) => `${call.method} ${new URL(call.url).pathname}`),
    [
      `POST /api/money/obligations/${OCCURRENCE.id}/payment`,
      `POST /api/money/obligations/${OCCURRENCE.id}/payment/correction`,
      `POST /api/money/obligations/${OCCURRENCE.id}/payment/undo`,
    ],
  );
  assert.deepEqual(calls[0].body, {
    version: 1,
    bookingDate: "2026-11-05",
    idempotencyKey: "obligation-payment:op-1",
    needVsWant: "need",
    operationId: "op-1",
  });
  assert.deepEqual(calls[2].body, { version: 3, operationId: "op-3" });
});

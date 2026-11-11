import assert from "node:assert/strict";
import test from "node:test";

import { createEgaApiClient } from "../src/client";

type CapturedRequest = {
  url: string;
  method: string;
  body: unknown;
};

function makeHarness(body: unknown = {}) {
  const calls: CapturedRequest[] = [];
  const fetch = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ) => {
    calls.push({
      url,
      method: init.method,
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    return new Response(JSON.stringify(body), {
      status: 200,
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

test("budget reads and versioned saves use the Money transport", async () => {
  const { client, calls } = makeHarness({ ok: true, plan: null });

  await client.money.getBudgetPlan({
    periodStartDate: "2026-11-09",
    periodEndDate: "2026-11-30",
  });
  assert.equal(
    calls[0]!.url,
    "https://api.ega.example/api/money/budget?periodStartDate=2026-11-09&periodEndDate=2026-11-30",
  );
  assert.equal(calls[0]!.method, "GET");

  await client.money.setAllocation({
    periodStartDate: "2026-11-09",
    periodEndDate: "2026-11-30",
    version: 1,
    allocations: { coffee: 7_000, groceries: null },
    coffeeWeeklyVisitLimit: 5,
  });
  assert.equal(calls[1]!.url, "https://api.ega.example/api/money/budget");
  assert.equal(calls[1]!.method, "PATCH");
  assert.deepEqual(calls[1]!.body, {
    periodStartDate: "2026-11-09",
    periodEndDate: "2026-11-30",
    version: 1,
    allocations: { coffee: 7_000, groceries: null },
    coffeeWeeklyVisitLimit: 5,
  });
});

test("counted visit create/delete and classification use the shared Money paths", async () => {
  const { client, calls } = makeHarness({ ok: true });

  await client.money.recordCoffeeVisit({
    visitKey: "visit-1",
    localDate: "2026-11-11",
    timezone: "Africa/Casablanca",
    expenseIds: ["00000000-0000-4000-8000-000000000001"],
  });
  assert.equal(calls[0]!.url, "https://api.ega.example/api/money/coffee-visits");
  assert.equal(calls[0]!.method, "POST");

  await client.money.listCoffeeVisits({
    from: "2026-11-09",
    to: "2026-11-15",
    limit: 50,
    offset: 10,
  });
  assert.equal(
    calls[1]!.url,
    "https://api.ega.example/api/money/coffee-visits?from=2026-11-09&to=2026-11-15&limit=50&offset=10",
  );
  assert.equal(calls[1]!.method, "GET");

  await client.money.deleteCoffeeVisit(
    "00000000-0000-4000-8000-000000000002",
    2,
  );
  assert.equal(
    calls[2]!.url,
    "https://api.ega.example/api/money/coffee-visits/00000000-0000-4000-8000-000000000002?version=2",
  );
  assert.equal(calls[2]!.method, "DELETE");

  await client.money.classifyExpense({
    expenseId: "00000000-0000-4000-8000-000000000001",
    version: 1,
    category: "groceries",
  });
  assert.equal(calls[3]!.url, "https://api.ega.example/api/money/classify");
  assert.equal(calls[3]!.method, "POST");
  assert.deepEqual(calls[3]!.body, {
    expenseId: "00000000-0000-4000-8000-000000000001",
    version: 1,
    category: "groceries",
  });
});

test("coffee window keeps integer limits in the query string", async () => {
  const { client, calls } = makeHarness({ ok: true, coffee: {} });
  await client.money.getCoffeeWindow({
    localDate: "2026-11-11",
    timezone: "Africa/Casablanca",
    periodStartDate: "2026-11-09",
    periodEndDate: "2026-11-30",
    spendLimitMinor: 7_000,
    visitLimitMinor: 5,
  });
  assert.equal(
    calls[0]!.url,
    "https://api.ega.example/api/money/coffee-window?localDate=2026-11-11&timezone=Africa%2FCasablanca&periodStartDate=2026-11-09&periodEndDate=2026-11-30&spendLimitMinor=7000&visitLimitMinor=5",
  );
});

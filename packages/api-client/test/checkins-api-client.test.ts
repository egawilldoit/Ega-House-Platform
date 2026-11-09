import assert from "node:assert/strict";
import test from "node:test";

import { createEgaApiClient } from "../src/client";

type CapturedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
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
      headers: init.headers,
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

test("checkins.get reads one owner/day record with the bearer token", async () => {
  const { client, calls } = makeHarness({ ok: true, checkin: null });
  const result = await client.checkins.get("2026-11-08", "Africa/Casablanca");
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "GET");
  assert.match(calls[0]?.url ?? "", /\/api\/checkins\?/);
  assert.match(calls[0]?.url ?? "", /localDate=2026-11-08/);
  assert.match(calls[0]?.url ?? "", /timezone=Africa%2FCasablanca/);
});

test("checkins.save posts the partial patch to the canonical route", async () => {
  const { client, calls } = makeHarness({ ok: true, checkin: {}, overtimeAdvisory: null });
  const result = await client.checkins.save({
    localDate: "2026-11-08",
    timezone: "Africa/Casablanca",
    patch: { outcomes: "Shipped the planner" },
  });
  assert.equal(result.ok, true);
  assert.equal(calls[0]?.method, "POST");
  assert.deepEqual(calls[0]?.body, {
    localDate: "2026-11-08",
    timezone: "Africa/Casablanca",
    patch: { outcomes: "Shipped the planner" },
  });
});

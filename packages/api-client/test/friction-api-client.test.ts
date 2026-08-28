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
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
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

test("friction radar maps GET /api/friction/radar with auth", async () => {
  const radar: Record<string, unknown> = {
    ok: true,
    generatedAt: "2026-08-27T12:00:00.000Z",
    thresholdDays: 7,
    blocked: [],
    staleTasks: [],
    staleGoals: [],
  };
  const { client, calls } = makeHarness(200, radar);
  const result = await client.friction.radar();
  assert.deepEqual(result, { ok: true, data: radar });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.ega.example/api/friction/radar");
  assert.equal(calls[0].headers.Authorization, "Bearer token-abc");
  assert.equal(calls[0].method, "GET");
});

test("friction radar maps error envelope", async () => {
  const { client } = makeHarness(500, { error: { code: "INTERNAL", message: "boom" } });
  const result = await client.friction.radar();
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "INTERNAL");
});

test("client exposes friction namespace", () => {
  const { client } = makeHarness();
  assert.equal(typeof client.friction.radar, "function");
});

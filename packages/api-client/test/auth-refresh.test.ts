import assert from "node:assert/strict";
import test from "node:test";

import { createEgaApiClient } from "../src/client";
import type { FetchLike } from "../src/http";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("authenticated 401 refreshes once and retries once with the refreshed token", async () => {
  const tokens = ["old-token", "new-token"];
  const seenAuth: string[] = [];
  let refreshCalls = 0;
  let requestCalls = 0;
  const fetch: FetchLike = async (_url, init) => {
    requestCalls += 1;
    seenAuth.push(init.headers.Authorization ?? "");
    return requestCalls === 1
      ? jsonResponse(401, { error: { code: "UNAUTHENTICATED", message: "Expired" } })
      : jsonResponse(200, { projects: [], summary: { total: 0, active: 0, completed: 0, archived: 0 } });
  };
  const client = createEgaApiClient({
    baseUrl: "https://api.example",
    getAccessToken: () => tokens[Math.min(requestCalls, 1)],
    refreshAccessToken: async () => { refreshCalls += 1; return true; },
    fetch: fetch as never,
  });

  const result = await client.projects.list();
  assert.equal(result.ok, true);
  assert.equal(refreshCalls, 1);
  assert.equal(requestCalls, 2);
  assert.deepEqual(seenAuth, ["Bearer old-token", "Bearer new-token"]);
});

test("terminal 401 never loops refresh and reports auth failure once", async () => {
  let refreshCalls = 0;
  let authErrors = 0;
  let requestCalls = 0;
  const fetch: FetchLike = async () => {
    requestCalls += 1;
    return jsonResponse(401, { error: { code: "UNAUTHENTICATED", message: "Expired" } });
  };
  const client = createEgaApiClient({
    baseUrl: "https://api.example",
    getAccessToken: () => "token",
    refreshAccessToken: async () => { refreshCalls += 1; return true; },
    onAuthError: () => { authErrors += 1; },
    fetch: fetch as never,
  });

  const result = await client.projects.list();
  assert.equal(result.ok, false);
  assert.equal(refreshCalls, 1);
  assert.equal(requestCalls, 2);
  assert.equal(authErrors, 1);
});

test("failed refresh returns unauthenticated without retrying the HTTP request", async () => {
  let requestCalls = 0;
  let refreshCalls = 0;
  const fetch: FetchLike = async () => {
    requestCalls += 1;
    return jsonResponse(401, { error: { code: "UNAUTHENTICATED", message: "Expired" } });
  };
  const client = createEgaApiClient({
    baseUrl: "https://api.example",
    getAccessToken: () => "old-token",
    refreshAccessToken: async () => { refreshCalls += 1; return false; },
    fetch: fetch as never,
  });

  const result = await client.projects.list();
  assert.equal(result.ok, false);
  assert.equal(refreshCalls, 1);
  assert.equal(requestCalls, 1);
});

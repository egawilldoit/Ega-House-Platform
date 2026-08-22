import assert from "node:assert/strict";
import test from "node:test";

import { createEgaApiClient } from "../src/client";
import type { FetchLike } from "../src/http";

type CapturedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
};

function makeHarness(
  responder: (call: { url: string; method: string; body: unknown }) => {
    status?: number;
    body: unknown;
  },
) {
  const calls: CapturedRequest[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call = {
      url,
      method: init.method,
      headers: init.headers,
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const outcome = responder(call);
    return new Response(JSON.stringify(outcome.body), {
      status: outcome.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };

  const client = createEgaApiClient({
    baseUrl: "https://api.ega.example",
    getAccessToken: () => "token-today",
    fetch: fetch as never,
  });

  return { client, calls };
}

test("today.get requests the rich mobile read model with an optional date", async () => {
  const todayResponse = {
    ok: true,
    date: "2026-08-10",
    sections: { planned: [], inProgress: [], blocked: [], completed: [] },
    suggestions: { pinned: [], inProgress: [] },
    summary: {
      plannedCount: 0,
      inProgressCount: 0,
      blockedCount: 0,
      completedCount: 0,
      selectedCount: 0,
      clearableCompletedCount: 0,
      overdueCount: 0,
      dueTodayCount: 0,
      totalEstimateMinutes: 0,
      trackedTodaySeconds: 0,
      trackedTodayLabel: "0s",
    },
    activeTimer: null,
  };
  const { client, calls } = makeHarness(() => ({ body: todayResponse }));

  await client.today.get();
  await client.today.get("2026-08-10");

  assert.equal(calls[0].url, "https://api.ega.example/api/today");
  assert.equal(calls[1].url, "https://api.ega.example/api/today?date=2026-08-10");
});

test("today mutations send contract payloads and tolerate blocked reasons", async () => {
  const { client, calls } = makeHarness(() => ({ body: { ok: true, taskId: "task-1" } }));

  const planned = await client.today.plan("task/1", "2026-08-10");
  const removed = await client.today.remove("task-1");
  const updated = await client.today.updateStatus("task-1", "blocked", "Waiting on API");
  const cleared = await client.today.clearCompleted("2026-08-10");

  assert.ok(planned.ok && removed.ok && updated.ok && cleared.ok);
  assert.equal(calls[0].url, "https://api.ega.example/api/today/tasks/task%2F1");
  assert.deepEqual(calls[2].body, { status: "blocked", blockedReason: "Waiting on API" });
  assert.deepEqual(calls[1].body, undefined);
});

test("timer resource targets the canonical workspace/start/stop endpoints", async () => {
  const workspace = {
    activeSession: null,
    summary: {
      trackedTodaySeconds: 60,
      trackedTodayLabel: "1m 0s",
      trackedTotalSeconds: 60,
      trackedTotalLabel: "1m 0s",
      sessionsTodayCount: 1,
      longestSessionSeconds: 60,
      longestSessionLabel: "1m 0s",
      longestSessionTaskTitle: "Task A",
    },
  };
  const { client, calls } = makeHarness((call) => {
    if (call.url.endsWith("/api/timer/workspace")) return { body: workspace };
    if (call.url.endsWith("/api/timer/start")) return { status: 201, body: { ok: true, activeSession: { sessionId: "s1", taskId: "t1", startedAt: "x", elapsedLabel: "0s", taskTitle: "Task A" } } };
    return { body: { ok: true, sessionId: "s1", taskId: "t1" } };
  });

  const ws = await client.timer.workspace();
  const start = await client.timer.start("t1");
  const stop = await client.timer.stop();

  assert.ok(ws.ok && start.ok && stop.ok);
  assert.equal(calls[0].url, "https://api.ega.example/api/timer/workspace");
  assert.deepEqual(calls[1].body, { taskId: "t1" });
  assert.deepEqual(calls[2].body, {});
  assert.equal(calls[2].headers.Authorization, "Bearer token-today");
});

test("auth resource issues session, refresh, and logout without bearer on login", async () => {
  const { client, calls } = makeHarness((call) => {
    if (call.url.endsWith("/api/auth/session")) {
      return {
        body: {
          ok: true,
          user: { id: "user-1", email: "user@example.com" },
          session: { accessToken: "a", refreshToken: "r", expiresAt: 100 },
        },
      };
    }
    if (call.url.endsWith("/api/auth/refresh")) {
      return { body: { ok: true, session: { accessToken: "a2", refreshToken: "r2", expiresAt: 200 } } };
    }
    return { body: { ok: true } };
  });

  const login = await client.auth.login("user@example.com", "secret");
  const refresh = await client.auth.refresh("r");
  const logout = await client.auth.logout();

  assert.ok(login.ok && refresh.ok && logout.ok);
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.deepEqual(calls[0].body, { email: "user@example.com", password: "secret" });
  assert.deepEqual(calls[1].body, { refreshToken: "r" });
  assert.equal(calls[2].headers.Authorization, "Bearer token-today");
});

test("auth failures surface the server error message", async () => {
  const { client } = makeHarness(() => ({
    status: 401,
    body: { ok: false, error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." } },
  }));

  const result = await client.auth.login("user@example.com", "wrong");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.message, "Email or password is incorrect.");
  }
});

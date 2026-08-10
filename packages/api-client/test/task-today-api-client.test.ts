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

function makeHarness(responseBody: unknown = { ok: true }) {
  const calls: CapturedRequest[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({
      url,
      method: init.method,
      headers: init.headers,
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const client = createEgaApiClient({
    baseUrl: "https://api.ega.example",
    getAccessToken: () => "token-task",
    fetch: fetch as never,
  });

  return { client, calls };
}

test("tasks list encodes filters and carries the bearer token", async () => {
  const { client, calls } = makeHarness({ tasks: [] });

  await client.tasks.list({
    status: "in_progress",
    projectId: "project/one",
    plannedForDate: "2026-08-10",
    includeArchived: true,
    limit: 20,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  assert.equal(
    calls[0].url,
    "https://api.ega.example/api/tasks?status=in_progress&projectId=project%2Fone&plannedForDate=2026-08-10&includeArchived=true&limit=20",
  );
  assert.equal(calls[0].headers.Authorization, "Bearer token-task");
});

test("tasks create/update/archive/reminder methods use the Hono transport contract", async () => {
  const { client, calls } = makeHarness({ ok: true, task: { id: "task-1" } });

  await client.tasks.create({
    title: "Wave 2",
    projectId: "project-1",
    goalId: null,
    description: null,
    blockedReason: null,
    status: "todo",
    priority: "medium",
    dueDate: null,
    estimateMinutes: null,
  });
  await client.tasks.update("task-1", { status: "done" });
  await client.tasks.archive("task-1");
  await client.tasks.unarchive("task-1");
  await client.tasks.createReminder("task-1", "2026-08-11T09:00:00.000Z");
  await client.tasks.cancelReminder("task-1", "reminder-1");

  assert.deepEqual(
    calls.map((call) => [call.method, call.url]),
    [
      ["POST", "https://api.ega.example/api/tasks"],
      ["PATCH", "https://api.ega.example/api/tasks/task-1"],
      ["POST", "https://api.ega.example/api/tasks/task-1/archive"],
      ["POST", "https://api.ega.example/api/tasks/task-1/unarchive"],
      ["POST", "https://api.ega.example/api/tasks/task-1/reminders"],
      ["PATCH", "https://api.ega.example/api/tasks/task-1/reminders/reminder-1"],
    ],
  );
  assert.deepEqual(calls[1].body, { status: "done" });
  assert.deepEqual(calls[4].body, { remindAt: "2026-08-11T09:00:00.000Z" });
  assert.deepEqual(calls[5].body, { status: "cancelled" });
});

test("Today uses the authenticated date-scoped transport endpoint", async () => {
  const { client, calls } = makeHarness({
    date: "2026-08-10",
    tasks: [],
    summary: { total: 0, completed: 0, remaining: 0 },
  });

  const result = await client.today.get("2026-08-10");

  assert.equal(result.ok, true);
  assert.equal(calls[0].url, "https://api.ega.example/api/today?date=2026-08-10");
  assert.equal(calls[0].headers.Authorization, "Bearer token-task");
});

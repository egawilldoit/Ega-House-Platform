import assert from "node:assert/strict";
import test from "node:test";

import { createEgaApiClient } from "../src/client";
import type { FetchLike } from "../src/http";

function makeHarness(responseBody: unknown = { ok: true }) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(responseBody), { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = createEgaApiClient({
    baseUrl: "https://api.ega.example",
    getAccessToken: () => "token-123",
    fetch: fetch as never,
  });
  return { client, calls };
}

test("notifications.list builds correct path and query", async () => {
  const { client, calls } = makeHarness({ ok: true, notifications: [], nextCursor: null });
  await client.notifications.list({ limit: 10, cursor: "2026-08-27T00:00:00.000Z" });
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /\/api\/notifications\?/);
  assert.match(calls[0]!.url, /limit=10/);
  assert.match(calls[0]!.url, /cursor=/);
  assert.equal(calls[0]!.method, "GET");
});

test("notifications.unreadCount uses GET /api/notifications/unread-count", async () => {
  const { client, calls } = makeHarness({ ok: true, unreadCount: 3 });
  const result = await client.notifications.unreadCount();
  assert.equal(calls[0]!.url, "https://api.ega.example/api/notifications/unread-count");
  assert.equal(calls[0]!.method, "GET");
  assert.equal(result.ok, true);
});

test("notifications.markRead uses PATCH /api/notifications/:id/read", async () => {
  const { client, calls } = makeHarness({ ok: true, notification: { id: "n1" } });
  await client.notifications.markRead("n1");
  assert.equal(calls[0]!.url, "https://api.ega.example/api/notifications/n1/read");
  assert.equal(calls[0]!.method, "PATCH");
});

test("notifications.markOpened uses PATCH /api/notifications/:id/opened", async () => {
  const { client, calls } = makeHarness({ ok: true, notification: { id: "n2" } });
  await client.notifications.markOpened("n2");
  assert.equal(calls[0]!.url, "https://api.ega.example/api/notifications/n2/opened");
  assert.equal(calls[0]!.method, "PATCH");
});

test("notifications.markAllRead uses POST /api/notifications/read-all", async () => {
  const { client, calls } = makeHarness({ ok: true, updatedCount: 2 });
  await client.notifications.markAllRead();
  assert.equal(calls[0]!.url, "https://api.ega.example/api/notifications/read-all");
  assert.equal(calls[0]!.method, "POST");
});

test("notifications.registerDevice POSTs correct body", async () => {
  const { client, calls } = makeHarness({ ok: true, device: { id: "d1" } });
  await client.notifications.registerDevice({ installationId: "inst-1", platform: "android", provider: "fcm", providerToken: "tok123" });
  assert.equal(calls[0]!.url, "https://api.ega.example/api/notifications/devices");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(calls[0]!.body, { installationId: "inst-1", platform: "android", provider: "fcm", providerToken: "tok123" });
});

test("notifications.unregisterDevice uses DELETE", async () => {
  const { client, calls } = makeHarness({ ok: true });
  await client.notifications.unregisterDevice("inst-1");
  assert.equal(calls[0]!.url, "https://api.ega.example/api/notifications/devices/inst-1");
  assert.equal(calls[0]!.method, "DELETE");
});

test("notifications.preferences GET and PATCH", async () => {
  const { client, calls } = makeHarness({ ok: true, preferences: [] });
  await client.notifications.preferences();
  assert.equal(calls[0]!.url, "https://api.ega.example/api/notifications/preferences");
  assert.equal(calls[0]!.method, "GET");

  const { client: client2, calls: calls2 } = makeHarness({ ok: true, preference: { notificationType: "task_reminder", pushEnabled: true, emailEnabled: false } });
  await client2.notifications.updatePreferences({ notificationType: "task_reminder", pushEnabled: true });
  assert.equal(calls2[0]!.url, "https://api.ega.example/api/notifications/preferences");
  assert.equal(calls2[0]!.method, "PATCH");
  assert.deepEqual(calls2[0]!.body, { notificationType: "task_reminder", pushEnabled: true });
});

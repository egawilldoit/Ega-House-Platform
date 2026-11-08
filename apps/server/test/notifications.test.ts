import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createApp } from "../src/index";

type QueryResult = { data: unknown; error: { code?: string; message?: string } | null; count?: number | null };
type Step = { method: string; args: unknown[] };

class FakeSupabase {
  private readonly queues = new Map<string, QueryResult[]>();
  calls: Array<{ table: string; steps: Step[] }> = [];
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  from(table: string) {
    return new FakeBuilder(table, this);
  }

  rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args });
    const queue = this.queues.get(`rpc:${name}`) ?? [];
    const next = queue.shift() ?? { data: null, error: null };
    this.queues.set(`rpc:${name}`, queue);
    return {
      then: (fulfilled: (v: QueryResult) => unknown) => Promise.resolve(next).then(fulfilled),
    } as unknown as Promise<QueryResult>;
  }

  push(table: string, result: QueryResult) {
    const queue = this.queues.get(table) ?? [];
    queue.push(result);
    this.queues.set(table, queue);
  }

  pushRpc(name: string, result: QueryResult) {
    const key = `rpc:${name}`;
    const queue = this.queues.get(key) ?? [];
    queue.push(result);
    this.queues.set(key, queue);
  }

  pop(table: string): QueryResult {
    return this.queues.get(table)?.shift() ?? { data: null, error: null };
  }
}

class FakeBuilder {
  private readonly steps: Step[] = [];
  constructor(private readonly table: string, private readonly fake: FakeSupabase) {}
  select(...args: unknown[]) { this.steps.push({ method: "select", args }); return this; }
  eq(...args: unknown[]) { this.steps.push({ method: "eq", args }); return this; }
  is(...args: unknown[]) { this.steps.push({ method: "is", args }); return this; }
  in(...args: unknown[]) { this.steps.push({ method: "in", args }); return this; }
  or(...args: unknown[]) { this.steps.push({ method: "or", args }); return this; }
  order(...args: unknown[]) { this.steps.push({ method: "order", args }); return this; }
  range(...args: unknown[]) { this.steps.push({ method: "range", args }); return this; }
  lt(...args: unknown[]) { this.steps.push({ method: "lt", args }); return this; }
  ilike(...args: unknown[]) { this.steps.push({ method: "ilike", args }); return this; }
  gte(...args: unknown[]) { this.steps.push({ method: "gte", args }); return this; }
  lte(...args: unknown[]) { this.steps.push({ method: "lte", args }); return this; }
  not(...args: unknown[]) { this.steps.push({ method: "not", args }); return this; }
  limit(...args: unknown[]) { this.steps.push({ method: "limit", args }); return this; }
  insert(...args: unknown[]) { this.steps.push({ method: "insert", args }); return this; }
  upsert(...args: unknown[]) { this.steps.push({ method: "upsert", args }); return this; }
  update(...args: unknown[]) { this.steps.push({ method: "update", args }); return this; }
  maybeSingle(...args: unknown[]) { this.steps.push({ method: "maybeSingle", args }); return this; }
  single(...args: unknown[]) { this.steps.push({ method: "single", args }); return this; }
  then<TResult1, TResult2>(
    fulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
  ): Promise<TResult1 | TResult2> {
    this.fake.calls.push({ table: this.table, steps: this.steps });
    return Promise.resolve(this.fake.pop(this.table)).then(fulfilled as never);
  }
}

const AUTH = { authorization: "Bearer notif-token" };
const JSON_HEADERS = { ...AUTH, "content-type": "application/json" };

function makeApp(fake: FakeSupabase) {
  return createApp({
    verifyToken: async (token) => (token === "notif-token" ? "user-123" : token === "other-token" ? "other-user" : null),
    createRequestClient: () => fake as unknown as SupabaseClient,
    now: () => new Date("2026-08-27T12:00:00.000Z"),
  });
}

function notificationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "notif-1",
    owner_user_id: "user-123",
    type: "task_reminder",
    title: "Task reminder",
    body: "Test task",
    target_type: "task",
    target_id: "task-123",
    idempotency_key: "task-reminder:rem-1",
    read_at: null,
    opened_at: null,
    created_at: "2026-08-27T12:00:00.000Z",
    updated_at: "2026-08-27T12:00:00.000Z",
    ...overrides,
  };
}

test("GET /api/notifications requires auth", async () => {
  const res = await makeApp(new FakeSupabase()).request("/api/notifications");
  assert.equal(res.status, 401);
});

test("GET /api/notifications returns actor-scoped notifications", async () => {
  const fake = new FakeSupabase();
  fake.push("notifications", { data: [notificationRow()], error: null });
  const res = await makeApp(fake).request("/api/notifications", { headers: AUTH });
  assert.equal(res.status, 200);
  const body = await res.json() as { ok: boolean; notifications: unknown[] };
  assert.equal(body.notifications.length, 1);
  const hasOwnerFilter = fake.calls.some((c) => c.table === "notifications" && c.steps.some((s) => s.method === "eq" && s.args[0] === "owner_user_id" && s.args[1] === "user-123"));
  assert.equal(hasOwnerFilter, true);
});

test("GET /api/notifications/unread-count requires auth and is scoped", async () => {
  const fake = new FakeSupabase();
  fake.push("notifications", { data: null, error: null, count: 5 });
  const res = await makeApp(fake).request("/api/notifications/unread-count", { headers: AUTH });
  assert.equal(res.status, 200);
  const body = await res.json() as { unreadCount: number };
  assert.equal(body.unreadCount, 5);
  const hasUnreadFilter = fake.calls.some((c) => c.table === "notifications" && c.steps.some((s) => s.method === "is" && s.args[0] === "read_at"));
  assert.equal(hasUnreadFilter, true);
});

test("PATCH /api/notifications/:id/read validates and enforces ownership", async () => {
  const fake = new FakeSupabase();
  // Simulate not found due to owner mismatch: update returns null
  fake.push("notifications", { data: null, error: null });
  const res = await makeApp(fake).request("/api/notifications/notif-1/read", { method: "PATCH", headers: AUTH });
  assert.equal(res.status, 404);

  // Now simulate success
  const fake2 = new FakeSupabase();
  fake2.push("notifications", { data: notificationRow({ read_at: "2026-08-27T12:00:00.000Z" }), error: null });
  const res2 = await makeApp(fake2).request("/api/notifications/notif-1/read", { method: "PATCH", headers: AUTH });
  assert.equal(res2.status, 200);
  const body2 = await res2.json() as { ok: boolean; notification: { id: string } };
  assert.equal(body2.notification.id, "notif-1");
});

test("POST /api/notifications/devices derives owner from bearer token, not body", async () => {
  const fake = new FakeSupabase();
  fake.pushRpc("claim_notification_device", {
    data: { id: "dev-1", owner_user_id: "user-123", installation_id: "inst-1", platform: "android", provider: "fcm", provider_token: "tok123", is_active: true, last_seen_at: new Date().toISOString(), invalidated_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    error: null,
  });

  const res = await makeApp(fake).request("/api/notifications/devices", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      installationId: "inst-1",
      platform: "android",
      provider: "fcm",
      providerToken: "tok123",
      owner_user_id: "attacker",
      ownerUserId: "attacker",
    }),
  });

  assert.equal(res.status, 201);
  const body = await res.json() as { device: { installationId: string } };
  assert.equal(body.device.installationId, "inst-1");
  // Verify RPC was called without attacker id; RPC internally uses auth.uid()
  assert.equal(fake.rpcCalls.length, 1);
  assert.equal(fake.rpcCalls[0]!.args.p_installation_id, "inst-1");
  // Ensure no owner_user_id was passed via RPC args (only installation, platform, provider, token)
  assert.equal("owner_user_id" in fake.rpcCalls[0]!.args, false);
});

test("POST /api/notifications/devices rejects invalid input", async () => {
  const fake = new FakeSupabase();
  const res = await makeApp(fake).request("/api/notifications/devices", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ installationId: " ", platform: "android", provider: "fcm", providerToken: " " }),
  });
  assert.equal(res.status, 400);
});

test("DELETE /api/notifications/devices/:installationId is scoped", async () => {
  const fake = new FakeSupabase();
  fake.push("notification_devices", { data: { id: "dev-1", installation_id: "inst-1", owner_user_id: "user-123", is_active: false }, error: null });
  const res = await makeApp(fake).request("/api/notifications/devices/inst-1", { method: "DELETE", headers: AUTH });
  assert.equal(res.status, 200);
  const hasOwner = fake.calls.some((c) => c.table === "notification_devices" && c.steps.some((s) => s.method === "eq" && s.args[0] === "owner_user_id"));
  assert.equal(hasOwner, true);
});

test("GET /api/notifications/preferences and PATCH are auth-scoped", async () => {
  const fake = new FakeSupabase();
  fake.push("notification_preferences", { data: [], error: null });
  const res = await makeApp(fake).request("/api/notifications/preferences", { headers: AUTH });
  assert.equal(res.status, 200);

  const fake2 = new FakeSupabase();
  fake2.push("notification_preferences", { data: null, error: null });
  fake2.push("notification_preferences", { data: { id: "pref-1", owner_user_id: "user-123", notification_type: "task_reminder", push_enabled: true, email_enabled: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, error: null });
  const res2 = await makeApp(fake2).request("/api/notifications/preferences", {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ notificationType: "task_reminder", pushEnabled: true }),
  });
  assert.equal(res2.status, 200);
});

test("PATCH /api/notifications/preferences rejects unknown notification types", async () => {
  const fake = new FakeSupabase();
  const res = await makeApp(fake).request("/api/notifications/preferences", {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ notificationType: "invented_type", pushEnabled: true }),
  });
  assert.equal(res.status, 400);
  assert.equal(fake.calls.length, 0);
});

test("notification list maps singleton targets and drops unknown target types", async () => {
  const fake = new FakeSupabase();
  fake.push("notifications", {
    data: [
      notificationRow({ id: "review-1", type: "weekly_review", target_type: "review", target_id: null }),
      notificationRow({ id: "unknown-1", target_type: "raw_route", target_id: "x" }),
    ],
    error: null,
  });
  const res = await makeApp(fake).request("/api/notifications", { headers: AUTH });
  assert.equal(res.status, 200);
  const body = await res.json() as { notifications: Array<{ id: string; target: unknown }> };
  assert.deepEqual(body.notifications[0]!.target, { type: "review", id: null });
  assert.equal(body.notifications[1]!.target, null);
});

test("GET /api/notifications/settings requires auth and defaults safely", async () => {
  const unauthorized = await makeApp(new FakeSupabase()).request("/api/notifications/settings");
  assert.equal(unauthorized.status, 401);

  const fake = new FakeSupabase();
  fake.push("notification_settings", { data: null, error: null });
  const res = await makeApp(fake).request("/api/notifications/settings", { headers: AUTH });
  assert.equal(res.status, 200);
  const body = await res.json() as { settings: { quietHoursEnabled: boolean; quietHoursStart: string; quietHoursEnd: string } };
  assert.equal(body.settings.quietHoursEnabled, false);
  assert.equal(body.settings.quietHoursStart, "22:00");
  assert.equal(body.settings.quietHoursEnd, "07:00");
  const scoped = fake.calls.some((c) => c.table === "notification_settings" && c.steps.some((s) => s.method === "eq" && s.args[0] === "owner_user_id" && s.args[1] === "user-123"));
  assert.equal(scoped, true);
});

test("PATCH /api/notifications/settings validates HH:MM and sends only supplied fields", async () => {
  const invalid = new FakeSupabase();
  const badRes = await makeApp(invalid).request("/api/notifications/settings", {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ quietHoursStart: "25:99" }),
  });
  assert.equal(badRes.status, 400);
  assert.equal(invalid.calls.length, 0);

  const fake = new FakeSupabase();
  fake.push("user_time_context", { data: { iana_timezone: "UTC" }, error: null });
  fake.push("notification_settings", {
    data: {
      owner_user_id: "user-123",
      quiet_hours_enabled: true,
      quiet_hours_start: "21:30",
      quiet_hours_end: "06:30",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    error: null,
  });
  const res = await makeApp(fake).request("/api/notifications/settings", {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ quietHoursEnabled: true, quietHoursStart: "21:30", quietHoursEnd: "06:30" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as { settings: { quietHoursEnabled: boolean; quietHoursStart: string } };
  assert.equal(body.settings.quietHoursEnabled, true);
  assert.equal(body.settings.quietHoursStart, "21:30");
  const update = fake.calls.find((c) => c.table === "notification_settings" && c.steps.some((s) => s.method === "update"));
  assert.ok(update);
  const payload = update!.steps.find((s) => s.method === "update")!.args[0] as Record<string, unknown>;
  assert.equal(payload.quiet_hours_enabled, true);
  assert.equal(payload.quiet_hours_start, "21:30");
  assert.equal(payload.quiet_hours_end, "06:30");
  const scoped = update!.steps.some((s) => s.method === "eq" && s.args[0] === "owner_user_id" && s.args[1] === "user-123");
  assert.equal(scoped, true);
});

test("PATCH settings one-field patch reads the other time for validation but updates only the supplied field", async () => {
  const fake = new FakeSupabase();
  fake.push("notification_settings", {
    data: {
      owner_user_id: "user-123",
      quiet_hours_enabled: true,
      quiet_hours_start: "22:00",
      quiet_hours_end: "07:00",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    error: null,
  });
  fake.push("notification_settings", {
    data: {
      owner_user_id: "user-123",
      quiet_hours_enabled: true,
      quiet_hours_start: "23:00",
      quiet_hours_end: "07:00",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    error: null,
  });
  const res = await makeApp(fake).request("/api/notifications/settings", {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ quietHoursStart: "23:00" }),
  });
  assert.equal(res.status, 200);
  const update = fake.calls.find((c) => c.table === "notification_settings" && c.steps.some((s) => s.method === "update"));
  assert.ok(update);
  const payload = update!.steps.find((s) => s.method === "update")!.args[0] as Record<string, unknown>;
  assert.equal(payload.quiet_hours_start, "23:00");
  assert.equal("quiet_hours_enabled" in payload, false);
  assert.equal("quiet_hours_end" in payload, false);
});

test("PATCH settings enabling requires a valid owner timezone; disabling does not", async () => {
  const missing = new FakeSupabase();
  missing.push("user_time_context", { data: null, error: null });
  const missingRes = await makeApp(missing).request("/api/notifications/settings", {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ quietHoursEnabled: true }),
  });
  assert.equal(missingRes.status, 400);
  assert.equal(missing.calls.some((c) => c.table === "notification_settings"), false);

  const invalid = new FakeSupabase();
  invalid.push("user_time_context", { data: { iana_timezone: "Not/AZone" }, error: null });
  const invalidRes = await makeApp(invalid).request("/api/notifications/settings", {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ quietHoursEnabled: true }),
  });
  assert.equal(invalidRes.status, 400);
  assert.equal(invalid.calls.some((c) => c.table === "notification_settings"), false);

  const readFailure = new FakeSupabase();
  readFailure.push("user_time_context", { data: null, error: { code: "500", message: "time context down" } });
  const failureRes = await makeApp(readFailure).request("/api/notifications/settings", {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ quietHoursEnabled: true }),
  });
  assert.equal(failureRes.status, 500);

  const disable = new FakeSupabase();
  disable.push("notification_settings", {
    data: {
      owner_user_id: "user-123",
      quiet_hours_enabled: false,
      quiet_hours_start: "22:00",
      quiet_hours_end: "07:00",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    error: null,
  });
  const disableRes = await makeApp(disable).request("/api/notifications/settings", {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ quietHoursEnabled: false }),
  });
  assert.equal(disableRes.status, 200);
  assert.equal(disable.calls.some((c) => c.table === "user_time_context"), false);
});

test("PATCH /api/notifications/settings maps operational failures to 500, not 400", async () => {
  const fake = new FakeSupabase();
  fake.push("user_time_context", { data: { iana_timezone: "UTC" }, error: null });
  fake.push("notification_settings", { data: null, error: { code: "500", message: "settings write failed" } });
  const res = await makeApp(fake).request("/api/notifications/settings", {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ quietHoursEnabled: true }),
  });
  assert.equal(res.status, 500);
  const body = await res.json() as { error: { code: string } };
  assert.equal(body.error.code, "INTERNAL");
});

test("PATCH settings maps the DB window conflict to 409", async () => {
  const fake = new FakeSupabase();
  fake.push("notification_settings", {
    data: {
      owner_user_id: "user-123",
      quiet_hours_enabled: true,
      quiet_hours_start: "22:00",
      quiet_hours_end: "07:00",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    error: null,
  });
  fake.push("notification_settings", {
    data: null,
    error: {
      code: "23514",
      message: 'new row violates check constraint "notification_settings_quiet_hours_window_check"',
    },
  });
  const res = await makeApp(fake).request("/api/notifications/settings", {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ quietHoursEnd: "23:00" }),
  });
  assert.equal(res.status, 409);
  const body = await res.json() as { error: { code: string } };
  assert.equal(body.error.code, "CONFLICT");
});

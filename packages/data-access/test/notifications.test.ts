import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { FcmPushProvider } from "../src/notifications/fcm-provider";
import { SupabaseNotificationSettingsRepository } from "../src/notifications/repository";

function mockFetch(status: number, body: unknown): typeof fetch {
  return (async () => {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
}

// Patch getAccessToken by injecting serviceAccount and mocking JWT? Instead we test via provider with mocked fetch for token?
// We'll bypass auth by providing a fake provider that skips token fetch? For unit classification, we can test FcmPushProvider's error handling by mocking fetch and providing serviceAccount but stubbing getAccessToken via dependency injection? Simpler: we create provider with serviceAccount null to test not-configured, and with mocked fetch for other cases by monkey patching google-auth-library import failure? Instead we test via direct classify helper.

import { classifyFcmError } from "@ega/application/notifications/delivery";

test("FCM error classification invalidates only proven token evidence", async () => {
  // Proven token-invalid evidence.
  assert.equal(classifyFcmError({ httpStatus: 404, fcmCode: "UNREGISTERED" }), "invalid_endpoint");
  assert.equal(
    classifyFcmError({
      httpStatus: 404,
      fcmCode: "NOT_FOUND",
      details: [{ errorCode: "UNREGISTERED" }],
    }),
    "invalid_endpoint",
  );
  assert.equal(
    classifyFcmError({
      httpStatus: 400,
      fcmCode: "INVALID_ARGUMENT",
      message: "The registration token is not a valid FCM registration token",
    }),
    "invalid_endpoint",
  );

  // Ambiguous status/codes never prove a stale token.
  assert.equal(classifyFcmError({ httpStatus: 404 }), "permanent");
  assert.equal(classifyFcmError({ httpStatus: 410 }), "permanent");
  assert.equal(classifyFcmError({ httpStatus: 404, fcmCode: "NOT_FOUND" }), "permanent");
  assert.equal(classifyFcmError({ httpStatus: 400, fcmCode: "INVALID_ARGUMENT" }), "permanent");
  assert.equal(classifyFcmError({ httpStatus: 400, fcmCode: "INVALID_PAYLOAD" }), "permanent");
  assert.equal(classifyFcmError({ httpStatus: 400, fcmCode: "SENDER_ID_MISMATCH" }), "auth");

  // Broad/substring/config matches must not deactivate a valid token.
  assert.equal(classifyFcmError({ httpStatus: 400, fcmCode: "UNREGISTERED_PROJECT" }), "permanent");
  assert.equal(classifyFcmError({ httpStatus: 400, fcmCode: "UNREGISTERED_APP" }), "permanent");
  assert.equal(
    classifyFcmError({ httpStatus: 400, details: [{ reason: "app unregistered" }] }),
    "permanent",
  );
  assert.equal(
    classifyFcmError({
      httpStatus: 400,
      details: [{ errorCode: "SOME_CONFIG", detail: "project-unregistered-detail" }],
    }),
    "permanent",
  );
  assert.equal(
    classifyFcmError({
      httpStatus: 400,
      fcmCode: "INVALID_ARGUMENT",
      message: "The registration token is valid; the message payload is invalid.",
    }),
    "permanent",
  );

  // Transient/auth retained.
  assert.equal(classifyFcmError({ httpStatus: 429 }), "transient");
  assert.equal(classifyFcmError({ httpStatus: 503, fcmCode: "UNAVAILABLE" }), "transient");
  assert.equal(classifyFcmError({ httpStatus: 401 }), "auth");
  assert.equal(classifyFcmError({ httpStatus: 403 }), "auth");

  // Precedence: transient/auth evidence wins over token-invalid text/details.
  assert.equal(
    classifyFcmError({
      httpStatus: 503,
      message: "The registration token is not a valid FCM registration token",
    }),
    "transient",
  );
  assert.equal(
    classifyFcmError({ httpStatus: 429, details: [{ errorCode: "UNREGISTERED" }] }),
    "transient",
  );
  assert.equal(classifyFcmError({ httpStatus: 500, fcmCode: "UNREGISTERED" }), "transient");
  assert.equal(
    classifyFcmError({
      httpStatus: 401,
      message: "The registration token is not a valid FCM registration token",
    }),
    "auth",
  );
  assert.equal(
    classifyFcmError({ httpStatus: 403, details: [{ errorCode: "UNREGISTERED" }] }),
    "auth",
  );
});

test("FcmPushProvider returns permanent for missing service account", async () => {
  const provider = new FcmPushProvider({ serviceAccount: null });
  const result = await provider.send({ token: "tok", title: "hi", body: "body", data: { notificationId: "n1", type: "task_reminder" } });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorCode, "permanent");
});

function fcmProvider(status: number, body: unknown) {
  return new FcmPushProvider({
    serviceAccount: {
      projectId: "proj",
      clientEmail: "a@b.iam.gserviceaccount.com",
      privateKey: "key",
    },
    fetchImpl: mockFetch(status, body),
    accessTokenProvider: async () => "access-token",
  });
}

const PUSH = { token: "device-token", title: "t", body: "b", data: { notificationId: "n1", type: "task_reminder" as const } };

test("FcmPushProvider maps structured token-invalid responses to invalid_endpoint", async () => {
  const unregistered = await fcmProvider(404, {
    error: {
      status: "NOT_FOUND",
      message: "Requested entity was not found.",
      details: [{ errorCode: "UNREGISTERED" }],
    },
  }).send(PUSH);
  assert.equal(unregistered.ok, false);
  if (!unregistered.ok) assert.equal(unregistered.errorCode, "invalid_endpoint");

  const invalidArgumentToken = await fcmProvider(400, {
    error: {
      status: "INVALID_ARGUMENT",
      message: "The registration token is not a valid FCM registration token",
    },
  }).send(PUSH);
  assert.equal(invalidArgumentToken.ok, false);
  if (!invalidArgumentToken.ok) assert.equal(invalidArgumentToken.errorCode, "invalid_endpoint");
});

test("FcmPushProvider never treats bare 404/410 or config errors as stale tokens", async () => {
  for (const status of [404, 410]) {
    const result = await fcmProvider(status, { error: { message: "not found" } }).send(PUSH);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.errorCode, "permanent");
  }

  const projectNotFound = await fcmProvider(404, {
    error: { status: "NOT_FOUND", message: "Requested entity was not found." },
  }).send(PUSH);
  assert.equal(projectNotFound.ok, false);
  if (!projectNotFound.ok) assert.equal(projectNotFound.errorCode, "permanent");

  const malformed = await fcmProvider(400, {
    error: { status: "INVALID_ARGUMENT", message: "Invalid payload" },
  }).send(PUSH);
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.errorCode, "permanent");

  const senderMismatch = await fcmProvider(400, {
    error: { status: "SENDER_ID_MISMATCH", message: "Sender mismatch" },
  }).send(PUSH);
  assert.equal(senderMismatch.ok, false);
  if (!senderMismatch.ok) assert.equal(senderMismatch.errorCode, "auth");
});

test("FcmPushProvider keeps config/substring/mixed errors non-deactivating", async () => {
  const project = await fcmProvider(400, {
    error: { status: "UNREGISTERED_PROJECT", message: "Project is unregistered" },
  }).send(PUSH);
  assert.equal(project.ok, false);
  if (!project.ok) assert.equal(project.errorCode, "permanent");

  const app = await fcmProvider(400, {
    error: { status: "UNREGISTERED_APP", message: "App is unregistered" },
  }).send(PUSH);
  assert.equal(app.ok, false);
  if (!app.ok) assert.equal(app.errorCode, "permanent");

  const reasonDetail = await fcmProvider(400, {
    error: { status: "INVALID_ARGUMENT", details: [{ reason: "app unregistered" }] },
  }).send(PUSH);
  assert.equal(reasonDetail.ok, false);
  if (!reasonDetail.ok) assert.equal(reasonDetail.errorCode, "permanent");

  const mixedMessage = await fcmProvider(400, {
    error: {
      status: "INVALID_ARGUMENT",
      message: "The registration token is valid; the message payload is invalid.",
    },
  }).send(PUSH);
  assert.equal(mixedMessage.ok, false);
  if (!mixedMessage.ok) assert.equal(mixedMessage.errorCode, "permanent");
});

test("FcmPushProvider lets transient/auth evidence win over token-invalid text", async () => {
  const unavailable = await fcmProvider(503, {
    error: {
      status: "UNAVAILABLE",
      message: "The registration token is not a valid FCM registration token",
      details: [{ errorCode: "UNREGISTERED" }],
    },
  }).send(PUSH);
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) assert.equal(unavailable.errorCode, "transient");

  const throttled = await fcmProvider(429, {
    error: { status: "RESOURCE_EXHAUSTED", details: [{ errorCode: "UNREGISTERED" }] },
  }).send(PUSH);
  assert.equal(throttled.ok, false);
  if (!throttled.ok) assert.equal(throttled.errorCode, "transient");

  const internal = await fcmProvider(500, { error: { status: "UNREGISTERED" } }).send(PUSH);
  assert.equal(internal.ok, false);
  if (!internal.ok) assert.equal(internal.errorCode, "transient");

  const unauthorized = await fcmProvider(401, {
    error: {
      status: "UNAUTHENTICATED",
      message: "The registration token is not a valid FCM registration token",
    },
  }).send(PUSH);
  assert.equal(unauthorized.ok, false);
  if (!unauthorized.ok) assert.equal(unauthorized.errorCode, "auth");

  const forbidden = await fcmProvider(403, {
    error: { status: "PERMISSION_DENIED", details: [{ errorCode: "UNREGISTERED" }] },
  }).send(PUSH);
  assert.equal(forbidden.ok, false);
  if (!forbidden.ok) assert.equal(forbidden.errorCode, "auth");
});

test("FcmPushProvider keeps transient 429/5xx retry semantics", async () => {  const throttled = await fcmProvider(429, { error: { status: "RESOURCE_EXHAUSTED" } }).send(PUSH);
  assert.equal(throttled.ok, false);
  if (!throttled.ok) assert.equal(throttled.errorCode, "transient");

  const unavailable = await fcmProvider(503, { error: { status: "UNAVAILABLE" } }).send(PUSH);
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) assert.equal(unavailable.errorCode, "transient");
});

function fakeSettingsClient(error: { code: string; message: string }): SupabaseClient {
  return {
    from(_table: string) {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return { data: null, error };
        },
      };
    },
  } as unknown as SupabaseClient;
}

test("notification settings missing table degrades to disabled quiet hours", async () => {
  const repository = new SupabaseNotificationSettingsRepository(
    fakeSettingsClient({
      code: "PGRST205",
      message: "Could not find the table 'public.notification_settings' in the schema cache",
    }),
  );
  const result = await repository.getSettings({ userId: "user-1" });
  assert.deepEqual(result, { ok: true, value: null });
});

test("notification settings 42P01 and exact table-message also degrade", async () => {
  const pg = new SupabaseNotificationSettingsRepository(
    fakeSettingsClient({
      code: "42P01",
      message: 'relation "public.notification_settings" does not exist',
    }),
  );
  assert.deepEqual(await pg.getSettings({ userId: "user-1" }), { ok: true, value: null });

  const messageOnly = new SupabaseNotificationSettingsRepository(
    fakeSettingsClient({
      code: "unknown",
      message: "Could not find the table 'public.notification_settings' in the schema cache",
    }),
  );
  assert.deepEqual(await messageOnly.getSettings({ userId: "user-1" }), { ok: true, value: null });
});

test("notification settings column/schema drift stays a failure", async () => {
  const undefinedColumn = new SupabaseNotificationSettingsRepository(
    fakeSettingsClient({
      code: "42703",
      message: 'column "quiet_hours_start" of relation "notification_settings" does not exist',
    }),
  );
  assert.equal((await undefinedColumn.getSettings({ userId: "user-1" })).ok, false);

  const postgrestColumn = new SupabaseNotificationSettingsRepository(
    fakeSettingsClient({
      code: "PGRST204",
      message:
        "Could not find the 'quiet_hours_start' column of 'notification_settings' in the schema cache",
    }),
  );
  assert.equal((await postgrestColumn.getSettings({ userId: "user-1" })).ok, false);
});

test("notification settings genuine read failures stay failures", async () => {
  const repository = new SupabaseNotificationSettingsRepository(
    fakeSettingsClient({ code: "500", message: "connection reset" }),
  );
  const result = await repository.getSettings({ userId: "user-1" });
  assert.equal(result.ok, false);
});

type SettingsWriteResult = { data: unknown; error: { code?: string; message?: string } | null };

function fakeSettingsWriteClient(results: SettingsWriteResult[]) {
  const calls: Array<{ method: "update" | "insert"; payload: Record<string, unknown> }> = [];
  let index = 0;
  const next = () => results[index++] ?? { data: null, error: null };
  const chain = (method: "update" | "insert", payload: Record<string, unknown>) => {
    calls.push({ method, payload });
    const builder = {
      eq() {
        return builder;
      },
      select() {
        return builder;
      },
      async maybeSingle() {
        return next();
      },
    };
    return builder;
  };
  const client = {
    from() {
      return {
        update(payload: Record<string, unknown>) {
          return chain("update", payload);
        },
        insert(payload: Record<string, unknown>) {
          return chain("insert", payload);
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

function settingsRow(overrides: Record<string, unknown> = {}) {
  return {
    owner_user_id: "user-1",
    quiet_hours_enabled: false,
    quiet_hours_start: "22:00",
    quiet_hours_end: "07:00",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("patchSettings updates only supplied fields on an existing row", async () => {
  const { client, calls } = fakeSettingsWriteClient([
    { data: settingsRow({ quiet_hours_start: "23:00" }), error: null },
  ]);
  const repository = new SupabaseNotificationSettingsRepository(client);
  const result = await repository.patchSettings({ userId: "user-1" }, { quietHoursStart: "23:00" });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, "update");
  assert.equal(calls[0]!.payload.quiet_hours_start, "23:00");
  assert.equal("quiet_hours_enabled" in calls[0]!.payload, false);
  assert.equal("quiet_hours_end" in calls[0]!.payload, false);
});

test("patchSettings inserts supplied fields plus documented defaults when no row exists", async () => {
  const { client, calls } = fakeSettingsWriteClient([
    { data: null, error: null },
    {
      data: settingsRow({
        quiet_hours_start: "23:00",
        quiet_hours_enabled: false,
        quiet_hours_end: "07:00",
      }),
      error: null,
    },
  ]);
  const repository = new SupabaseNotificationSettingsRepository(client);
  const result = await repository.patchSettings({ userId: "user-1" }, { quietHoursStart: "23:00" });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((call) => call.method), ["update", "insert"]);
  assert.equal(calls[1]!.payload.quiet_hours_start, "23:00");
  assert.equal(calls[1]!.payload.quiet_hours_enabled, false);
  assert.equal(calls[1]!.payload.quiet_hours_end, "07:00");
});

test("patchSettings retries the partial update once after a first-row 23505", async () => {
  const { client, calls } = fakeSettingsWriteClient([
    { data: null, error: null },
    { data: null, error: { code: "23505", message: "duplicate key" } },
    {
      data: settingsRow({ quiet_hours_enabled: true, quiet_hours_start: "23:00" }),
      error: null,
    },
  ]);
  const repository = new SupabaseNotificationSettingsRepository(client);
  const result = await repository.patchSettings({ userId: "user-1" }, { quietHoursStart: "23:00" });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((call) => call.method), ["update", "insert", "update"]);
  assert.equal(calls[2]!.payload.quiet_hours_start, "23:00");
  assert.equal("quiet_hours_enabled" in calls[2]!.payload, false);
});

test("patchSettings surfaces update errors instead of success-shaped data", async () => {
  const { client } = fakeSettingsWriteClient([
    { data: null, error: { code: "42703", message: "column missing" } },
  ]);
  const repository = new SupabaseNotificationSettingsRepository(client);
  const result = await repository.patchSettings({ userId: "user-1" }, { quietHoursEnabled: true });
  assert.equal(result.ok, false);
});

test("patchSettings maps the quiet-hours window check violation to a conflict", async () => {
  const updatePath = fakeSettingsWriteClient([
    { data: null, error: { code: "23514", message: 'new row violates check constraint "notification_settings_quiet_hours_window_check"' } },
  ]);
  const updateRepo = new SupabaseNotificationSettingsRepository(updatePath.client);
  const updateResult = await updateRepo.patchSettings(
    { userId: "user-1" },
    { quietHoursEnd: "23:00" },
  );
  assert.equal(updateResult.ok, false);
  if (!updateResult.ok) assert.equal(updateResult.error.code, "conflict");

  const insertPath = fakeSettingsWriteClient([
    { data: null, error: null },
    { data: null, error: { code: "23514", message: 'new row violates check constraint "notification_settings_quiet_hours_window_check"' } },
  ]);
  const insertRepo = new SupabaseNotificationSettingsRepository(insertPath.client);
  const insertResult = await insertRepo.patchSettings(
    { userId: "user-1" },
    { quietHoursEnd: "23:00" },
  );
  assert.equal(insertResult.ok, false);
  if (!insertResult.ok) assert.equal(insertResult.error.code, "conflict");
});

test("patchSettings leaves unrelated 23514 check violations as generic failures", async () => {
  const { client } = fakeSettingsWriteClient([
    {
      data: null,
      error: {
        code: "23514",
        message: 'new row violates check constraint "notification_settings_quiet_hours_start_check"',
      },
    },
  ]);
  const repository = new SupabaseNotificationSettingsRepository(client);
  const result = await repository.patchSettings({ userId: "user-1" }, { quietHoursStart: "23:00" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "unknown");
});

import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "../src/auth/actor";
import {
  classifyFcmError,
  nextRetryAt,
  resolveDeliveryChannels,
  MAX_DELIVERY_ATTEMPTS,
} from "../src/notifications/delivery";
import {
  createNotification,
  listNotifications,
  markNotificationRead,
  getNotificationPreferences,
  updateNotificationPreferences,
  registerNotificationDevice,
} from "../src/notifications/service";
import type {
  NotificationRepository,
  NotificationDeviceRepository,
  NotificationPreferenceRepository,
  NotificationRecord,
  NotificationPreferenceRecord,
  NotificationDeviceRecord,
} from "../src/notifications/ports";
import type { RepositoryResult } from "../src/shared/result";

const ACTOR = createAuthenticatedActor("user-123");

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}
function fail<T = never>(): RepositoryResult<T> {
  return { ok: false, error: { code: "unknown" } };
}

test("resolveDeliveryChannels respects preferences and deliveryMode", () => {
  assert.deepEqual(resolveDeliveryChannels({ deliveryMode: "push", preferences: { pushEnabled: true, emailEnabled: true } }), { push: true, email: false });
  assert.deepEqual(resolveDeliveryChannels({ deliveryMode: "email", preferences: { pushEnabled: true, emailEnabled: true } }), { push: false, email: true });
  assert.deepEqual(resolveDeliveryChannels({ deliveryMode: "both", preferences: { pushEnabled: false, emailEnabled: true } }), { push: false, email: true });
  assert.deepEqual(resolveDeliveryChannels({ deliveryMode: "both", preferences: { pushEnabled: true, emailEnabled: false } }), { push: true, email: false });
  assert.deepEqual(resolveDeliveryChannels({ deliveryMode: "push", preferences: null }), { push: true, email: false });
});

test("nextRetryAt exponential backoff and max attempts", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  assert.equal(nextRetryAt(1, now), new Date("2026-08-27T00:01:00.000Z").toISOString());
  assert.equal(nextRetryAt(2, now), new Date("2026-08-27T00:02:00.000Z").toISOString());
  assert.equal(nextRetryAt(5, now), new Date("2026-08-27T00:16:00.000Z").toISOString());
  assert.equal(nextRetryAt(6, now), null);
  assert.equal(nextRetryAt(MAX_DELIVERY_ATTEMPTS + 1, now), null);
});

test("classifyFcmError distinguishes invalid endpoint, transient, auth, permanent", () => {
  assert.equal(classifyFcmError({ httpStatus: 404, fcmCode: "UNREGISTERED" }), "invalid_endpoint");
  assert.equal(classifyFcmError({ httpStatus: 400, fcmCode: "INVALID_ARGUMENT" }), "invalid_endpoint");
  assert.equal(classifyFcmError({ httpStatus: 429, fcmCode: "RESOURCE_EXHAUSTED" }), "transient");
  assert.equal(classifyFcmError({ httpStatus: 500 }), "transient");
  assert.equal(classifyFcmError({ httpStatus: 503, fcmCode: "UNAVAILABLE" }), "transient");
  assert.equal(classifyFcmError({ httpStatus: 401, fcmCode: "UNAUTHENTICATED" }), "auth");
  assert.equal(classifyFcmError({ httpStatus: 400, fcmCode: "SOME_OTHER" }), "permanent");
});

test("createNotification validates input and delegates idempotently", async () => {
  const fakeRepo: NotificationRepository = {
    createNotification: async (_actor, input) => ok({ id: "n1", ownerUserId: ACTOR.userId, type: input.type, title: input.title, body: input.body ?? null, targetType: input.target?.type ?? null, targetId: input.target?.id ?? null, idempotencyKey: input.idempotencyKey, readAt: null, openedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as NotificationRecord),
    getNotification: async () => ok(null),
    listNotifications: async () => ok({ notifications: [], nextCursor: null }),
    countUnread: async () => ok(0),
    markRead: async () => ok(null),
    markOpened: async () => ok(null),
    markAllRead: async () => ok(0),
  };

  const okResult = await createNotification(ACTOR, fakeRepo, { type: "task_reminder", title: "Task reminder", idempotencyKey: "task-reminder:123" });
  assert.equal(okResult.ok, true);

  const missingTitle = await createNotification(ACTOR, fakeRepo, { type: "task_reminder", title: " ", idempotencyKey: "k" });
  assert.equal(missingTitle.ok, false);

  const missingKey = await createNotification(ACTOR, fakeRepo, { type: "task_reminder", title: "t", idempotencyKey: " " });
  assert.equal(missingKey.ok, false);
});

test("listNotifications enforces actor and limit", async () => {
  let capturedLimit = 0;
  const fakeRepo: NotificationRepository = {
    createNotification: async () => fail(),
    getNotification: async () => ok(null),
    listNotifications: async (_actor, q) => { capturedLimit = q.limit ?? 0; return ok({ notifications: [], nextCursor: null }); },
    countUnread: async () => ok(0),
    markRead: async () => ok(null),
    markOpened: async () => ok(null),
    markAllRead: async () => ok(0),
  };

  const result = await listNotifications(ACTOR, fakeRepo, { limit: 500 });
  assert.equal(result.ok, true);
  assert.equal(capturedLimit, 100); // clamped
});

test("markNotificationRead requires id and handles not found", async () => {
  const fakeRepo: NotificationRepository = {
    createNotification: async () => fail(),
    getNotification: async () => ok(null),
    listNotifications: async () => ok({ notifications: [], nextCursor: null }),
    countUnread: async () => ok(0),
    markRead: async () => ok(null),
    markOpened: async () => ok(null),
    markAllRead: async () => ok(0),
  };
  const noId = await markNotificationRead(ACTOR, fakeRepo, " ");
  assert.equal(noId.ok, false);
  const notFound = await markNotificationRead(ACTOR, fakeRepo, "n1");
  assert.equal(notFound.ok, false);
  assert.match(notFound.errorMessage, /not found/i);
});

test("preferences default to task_reminder enabled when none stored", async () => {
  const fakePrefs: NotificationPreferenceRepository = {
    listPreferences: async () => ok([]),
    upsertPreference: async () => fail(),
  };
  const result = await getNotificationPreferences(ACTOR, fakePrefs);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0]!.notificationType, "task_reminder");
    assert.equal(result.data[0]!.pushEnabled, true);
  }
});

test("updateNotificationPreferences validates type", async () => {
  const fakePrefs: NotificationPreferenceRepository = {
    listPreferences: async () => ok([]),
    upsertPreference: async (_actor, input) => ok({ id: "p1", ownerUserId: ACTOR.userId, notificationType: input.notificationType, pushEnabled: input.pushEnabled ?? true, emailEnabled: input.emailEnabled ?? true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as NotificationPreferenceRecord),
  };
  const badType = await updateNotificationPreferences(ACTOR, fakePrefs, { notificationType: "timer" as never });
  assert.equal(badType.ok, false);
  const okPref = await updateNotificationPreferences(ACTOR, fakePrefs, { notificationType: "task_reminder", pushEnabled: false });
  assert.equal(okPref.ok, true);
});

test("registerNotificationDevice validates platform and token", async () => {
  const fakeDevices: NotificationDeviceRepository = {
    claimDevice: async () => ok({ id: "d1", ownerUserId: ACTOR.userId, installationId: "inst1", platform: "android", provider: "fcm", providerToken: "tok", isActive: true, lastSeenAt: new Date().toISOString(), invalidatedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as NotificationDeviceRecord),
    getDeviceByInstallationId: async () => ok(null),
    deactivateDevice: async () => ok(null),
    listActiveDevices: async () => ok([]),
    deactivateByToken: async () => ok(undefined),
  };

  const missingToken = await registerNotificationDevice(ACTOR, fakeDevices, { installationId: "inst1", platform: "android", provider: "fcm", providerToken: " " });
  assert.equal(missingToken.ok, false);

  const okReg = await registerNotificationDevice(ACTOR, fakeDevices, { installationId: "inst1", platform: "android", provider: "fcm", providerToken: "tok123" });
  assert.equal(okReg.ok, true);
});

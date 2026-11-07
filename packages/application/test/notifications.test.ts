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
  getNotificationSettings,
  updateNotificationPreferences,
  updateNotificationSettings,
  registerNotificationDevice,
} from "../src/notifications/service";
import type {
  NotificationRepository,
  NotificationDeviceRepository,
  NotificationPreferenceRepository,
  NotificationSettingsRepository,
  NotificationRecord,
  NotificationPreferenceRecord,
  NotificationDeviceRecord,
} from "../src/notifications/ports";
import type { RepositoryResult } from "../src/shared/result";
import type { TimeContextRepository } from "../src/shared/time-context";

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

test("classifyFcmError only invalidates endpoints on proven token evidence", () => {
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

  // Ambiguous HTTP status / generic codes never prove a stale token.
  assert.equal(classifyFcmError({ httpStatus: 404 }), "permanent");
  assert.equal(classifyFcmError({ httpStatus: 410 }), "permanent");
  assert.equal(classifyFcmError({ httpStatus: 404, fcmCode: "NOT_FOUND" }), "permanent");
  assert.equal(classifyFcmError({ httpStatus: 400, fcmCode: "INVALID_ARGUMENT" }), "permanent");
  assert.equal(classifyFcmError({ httpStatus: 400, fcmCode: "INVALID_PAYLOAD" }), "permanent");
  assert.equal(classifyFcmError({ httpStatus: 400, fcmCode: "SENDER_ID_MISMATCH" }), "auth");
  assert.equal(classifyFcmError({ httpStatus: 400, fcmCode: "INVALID_TOKEN" }), "permanent");

  // Transient and auth semantics retained.
  assert.equal(classifyFcmError({ httpStatus: 429, fcmCode: "RESOURCE_EXHAUSTED" }), "transient");
  assert.equal(classifyFcmError({ httpStatus: 500 }), "transient");
  assert.equal(classifyFcmError({ httpStatus: 503, fcmCode: "UNAVAILABLE" }), "transient");
  assert.equal(classifyFcmError({ httpStatus: 401, fcmCode: "UNAUTHENTICATED" }), "auth");
  assert.equal(classifyFcmError({ httpStatus: 403 }), "auth");
});

test("createNotification validates input and delegates idempotently", async () => {
  const fakeRepo: NotificationRepository = {
    createNotification: async (_actor, input) => ({
      ok: true,
      value: {
        notification: { id: "n1", ownerUserId: ACTOR.userId, type: input.type, title: input.title, body: input.body ?? null, targetType: input.target?.type ?? null, targetId: input.target?.id ?? null, idempotencyKey: input.idempotencyKey, readAt: null, openedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as NotificationRecord,
        created: true,
      },
    }),
    getNotification: async () => ok(null),
    listNotifications: async () => ok({ notifications: [], nextCursor: null }),
    countUnread: async () => ok(0),
    markRead: async () => ok(null),
    markOpened: async () => ok(null),
    markAllRead: async () => ok(0),
  };

  const okResult = await createNotification(ACTOR, fakeRepo, { type: "task_reminder", title: "Task reminder", idempotencyKey: "task_reminder:123" });
  assert.equal(okResult.ok, true);
  if (okResult.ok) {
    assert.equal(okResult.data.created, true);
    assert.equal(okResult.data.notification.id, "n1");
  }

  const missingTitle = await createNotification(ACTOR, fakeRepo, { type: "task_reminder", title: " ", idempotencyKey: "task_reminder:123" });
  assert.equal(missingTitle.ok, false);

  const missingKey = await createNotification(ACTOR, fakeRepo, { type: "task_reminder", title: "t", idempotencyKey: " " });
  assert.equal(missingKey.ok, false);

  const badType = await createNotification(ACTOR, fakeRepo, { type: "invented" as never, title: "t", idempotencyKey: "task_reminder:1" });
  assert.equal(badType.ok, false);

  const badTarget = await createNotification(ACTOR, fakeRepo, { type: "task_reminder", title: "t", idempotencyKey: "task_reminder:2", target: { type: "task", id: "/evil?path" } });
  assert.equal(badTarget.ok, true);
  if (badTarget.ok) {
    // Invalid/raw targets safely degrade to no target rather than a path.
    assert.equal(badTarget.data.notification.targetType, null);
    assert.equal(badTarget.data.notification.targetId, null);
  }
});

test("event keys are canonicalized before persistence and cannot cross types", async () => {
  const seenKeys: string[] = [];
  const records: NotificationRecord[] = [];
  const repo: NotificationRepository = {
    createNotification: async (actor, input) => {
      seenKeys.push(input.idempotencyKey);
      const existing = records.find((n) => n.idempotencyKey === input.idempotencyKey);
      if (existing) return ok({ notification: existing, created: false });
      const record: NotificationRecord = {
        id: `n${records.length + 1}`,
        ownerUserId: actor.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        targetType: input.target?.type ?? null,
        targetId: input.target?.id ?? null,
        idempotencyKey: input.idempotencyKey,
        readAt: null,
        openedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      records.push(record);
      return ok({ notification: record, created: true });
    },
    getNotification: async () => ok(null),
    listNotifications: async () => ok({ notifications: [], nextCursor: null }),
    countUnread: async () => ok(0),
    markRead: async () => ok(null),
    markOpened: async () => ok(null),
    markAllRead: async () => ok(0),
  };

  const padded = await createNotification(ACTOR, repo, {
    type: "task_reminder",
    title: "Task reminder",
    idempotencyKey: "  task_reminder:evt-1  ",
  });
  const canonical = await createNotification(ACTOR, repo, {
    type: "task_reminder",
    title: "Task reminder",
    idempotencyKey: "task_reminder:evt-1",
  });

  assert.equal(padded.ok, true);
  assert.equal(canonical.ok, true);
  assert.equal(records.length, 1);
  assert.equal(seenKeys[0], "task_reminder:evt-1");
  assert.equal(padded.ok ? padded.data.created : null, true);
  assert.equal(canonical.ok ? canonical.data.created : null, false);

  const mismatched = await createNotification(ACTOR, repo, {
    type: "money_threshold",
    title: "Spent $10 at Acme",
    idempotencyKey: "task_reminder:evt-1",
  });
  assert.equal(mismatched.ok, false);
  assert.equal(records.length, 1);
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

test("notification settings default to disabled 22:00-07:00", async () => {
  const fakeSettings: NotificationSettingsRepository = {
    getSettings: async () => ok(null),
    patchSettings: async () => fail(),
  };
  const result = await getNotificationSettings(ACTOR, fakeSettings);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.quietHoursEnabled, false);
    assert.equal(result.data.quietHoursStart, "22:00");
    assert.equal(result.data.quietHoursEnd, "07:00");
  }
});

test("settings patches send only supplied fields and preserve concurrent fields", async () => {
  let store = {
    ownerUserId: ACTOR.userId,
    quietHoursEnabled: false,
    quietHoursStart: "22:00",
    quietHoursEnd: "07:00",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const patches: Array<Record<string, unknown>> = [];
  const fakeSettings: NotificationSettingsRepository = {
    getSettings: async () => ok(store),
    patchSettings: async (actor, patch) => {
      patches.push(patch as Record<string, unknown>);
      // Fake per-field application; the real atomicity is proved in PostgreSQL.
      store = {
        ...store,
        ...(patch.quietHoursEnabled !== undefined
          ? { quietHoursEnabled: patch.quietHoursEnabled }
          : {}),
        ...(patch.quietHoursStart !== undefined ? { quietHoursStart: patch.quietHoursStart } : {}),
        ...(patch.quietHoursEnd !== undefined ? { quietHoursEnd: patch.quietHoursEnd } : {}),
      };
      return ok({ ...store, ownerUserId: actor.userId });
    },
  };
  const timeContext: TimeContextRepository = {
    getTimezone: async () => ok("UTC"),
    setTimezone: async () => ok("UTC"),
  };

  const enable = await updateNotificationSettings(ACTOR, fakeSettings, timeContext, {
    quietHoursEnabled: true,
  });
  assert.equal(enable.ok, true);
  assert.deepEqual(patches.at(-1), { quietHoursEnabled: true });

  const startOnly = await updateNotificationSettings(ACTOR, fakeSettings, timeContext, {
    quietHoursStart: "23:00",
  });
  assert.equal(startOnly.ok, true);
  assert.deepEqual(patches.at(-1), { quietHoursStart: "23:00" });
  // Both prior fields remain durable after the one-field patch.
  assert.equal(store.quietHoursEnabled, true);
  assert.equal(store.quietHoursStart, "23:00");
  assert.equal(store.quietHoursEnd, "07:00");

  const endOnly = await updateNotificationSettings(ACTOR, fakeSettings, timeContext, {
    quietHoursEnd: "06:00",
  });
  assert.equal(endOnly.ok, true);
  assert.deepEqual(patches.at(-1), { quietHoursEnd: "06:00" });
  assert.equal(store.quietHoursStart, "23:00");
  assert.equal(store.quietHoursEnd, "06:00");
});

test("settings validation rejects malformed, equal, and empty patches without persisting", async () => {
  const patches: Array<Record<string, unknown>> = [];
  const fakeSettings: NotificationSettingsRepository = {
    getSettings: async () =>
      ok({
        ownerUserId: ACTOR.userId,
        quietHoursEnabled: false,
        quietHoursStart: "22:00",
        quietHoursEnd: "07:00",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    patchSettings: async (_actor, patch) => {
      patches.push(patch as Record<string, unknown>);
      return ok({
        ownerUserId: ACTOR.userId,
        quietHoursEnabled: patch.quietHoursEnabled ?? false,
        quietHoursStart: patch.quietHoursStart ?? "22:00",
        quietHoursEnd: patch.quietHoursEnd ?? "07:00",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    },
  };
  const timeContext: TimeContextRepository = {
    getTimezone: async () => ok("UTC"),
    setTimezone: async () => ok("UTC"),
  };

  const badStart = await updateNotificationSettings(ACTOR, fakeSettings, timeContext, {
    quietHoursStart: "25:99",
  });
  assert.equal(badStart.ok, false);
  if (!badStart.ok) assert.equal(badStart.code, "validation");

  const badEnd = await updateNotificationSettings(ACTOR, fakeSettings, timeContext, {
    quietHoursEnd: "7:00",
  });
  assert.equal(badEnd.ok, false);
  if (!badEnd.ok) assert.equal(badEnd.code, "validation");

  const equal = await updateNotificationSettings(ACTOR, fakeSettings, timeContext, {
    quietHoursStart: "08:00",
    quietHoursEnd: "08:00",
  });
  assert.equal(equal.ok, false);
  if (!equal.ok) assert.equal(equal.code, "validation");

  const equalViaExisting = await updateNotificationSettings(ACTOR, fakeSettings, timeContext, {
    quietHoursStart: "07:00",
  });
  assert.equal(equalViaExisting.ok, false);
  if (!equalViaExisting.ok) assert.equal(equalViaExisting.code, "validation");

  const empty = await updateNotificationSettings(ACTOR, fakeSettings, timeContext, {});
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.code, "validation");

  assert.equal(patches.length, 0);
});

test("enabling quiet hours requires a valid owner timezone; disabling does not", async () => {
  const patches: Array<Record<string, unknown>> = [];
  const fakeSettings: NotificationSettingsRepository = {
    getSettings: async () => ok(null),
    patchSettings: async (actor, patch) => {
      patches.push(patch as Record<string, unknown>);
      return ok({
        ownerUserId: actor.userId,
        quietHoursEnabled: patch.quietHoursEnabled ?? false,
        quietHoursStart: patch.quietHoursStart ?? "22:00",
        quietHoursEnd: patch.quietHoursEnd ?? "07:00",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    },
  };

  const missingTimezone: TimeContextRepository = {
    getTimezone: async () => ok(null),
    setTimezone: async () => ok("UTC"),
  };
  const invalidTimezone: TimeContextRepository = {
    getTimezone: async () => ok("Not/AZone"),
    setTimezone: async () => ok("UTC"),
  };
  const failedTimezoneRead: TimeContextRepository = {
    getTimezone: async () => fail(),
    setTimezone: async () => ok("UTC"),
  };
  const validTimezone: TimeContextRepository = {
    getTimezone: async () => ok("Africa/Casablanca"),
    setTimezone: async () => ok("Africa/Casablanca"),
  };

  for (const repository of [missingTimezone, invalidTimezone]) {
    const result = await updateNotificationSettings(ACTOR, fakeSettings, repository, {
      quietHoursEnabled: true,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "validation");
  }

  const infra = await updateNotificationSettings(ACTOR, fakeSettings, failedTimezoneRead, {
    quietHoursEnabled: true,
  });
  assert.equal(infra.ok, false);
  if (!infra.ok) assert.equal(infra.code, "unknown");
  assert.equal(patches.length, 0);

  const enabled = await updateNotificationSettings(ACTOR, fakeSettings, validTimezone, {
    quietHoursEnabled: true,
  });
  assert.equal(enabled.ok, true);
  assert.deepEqual(patches.at(-1), { quietHoursEnabled: true });

  const disabled = await updateNotificationSettings(ACTOR, fakeSettings, missingTimezone, {
    quietHoursEnabled: false,
  });
  assert.equal(disabled.ok, true);
  assert.deepEqual(patches.at(-1), { quietHoursEnabled: false });
});

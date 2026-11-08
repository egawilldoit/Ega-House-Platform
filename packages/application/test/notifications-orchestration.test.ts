import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "../src/auth/actor";
import {
  createNotification,
  processDueTaskReminders,
  processPendingNotificationDeliveries,
} from "../src/notifications/service";
import type {
  EmailDestinationResolver,
  EmailProvider,
  NotificationDeliveryRecord,
  NotificationDeviceRecord,
  NotificationPreferenceRecord,
  NotificationRecord,
  NotificationSettingsRecord,
  PushProvider,
  TaskReminderIntentRecord,
} from "../src/notifications/ports";
import type { TimeContextRepository } from "../src/shared/time-context";
import type { RepositoryResult } from "../src/shared/result";

const NOW = new Date("2026-01-15T12:00:00.000Z");
const NOW_ISO = NOW.toISOString();
const OWNER = "11111111-1111-1111-1111-111111111111";
const ACTOR = createAuthenticatedActor(OWNER);
const TASK_ID = "22222222-2222-2222-2222-222222222222";

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}

type IntentState = {
  id: string;
  ownerUserId: string;
  taskId: string;
  remindAt: string;
  deliveryMode: "push" | "email" | "both";
  status: string;
  taskTitle: string | null;
};

type State = {
  notifications: NotificationRecord[];
  deliveries: NotificationDeliveryRecord[];
  devices: NotificationDeviceRecord[];
  preferences: NotificationPreferenceRecord[];
  settings: NotificationSettingsRecord | null;
  timezone: string | null;
  intents: IntentState[];
  deactivatedTokens: string[];
  nextId: number;
  preferencesUnavailable: boolean;
  settingsUnavailable: boolean;
  timeContextUnavailable: boolean;
  devicesUnavailable: boolean;
  notificationReadUnavailable: boolean;
  deliveryUpdateUnavailable: boolean;
};

function createState(overrides: Partial<State> = {}): State {
  return {
    notifications: [],
    deliveries: [],
    devices: [],
    preferences: [],
    settings: null,
    timezone: "UTC",
    intents: [],
    deactivatedTokens: [],
    nextId: 0,
    preferencesUnavailable: false,
    settingsUnavailable: false,
    timeContextUnavailable: false,
    devicesUnavailable: false,
    notificationReadUnavailable: false,
    deliveryUpdateUnavailable: false,
    ...overrides,
  };
}

function device(state: State, token = "token-1"): NotificationDeviceRecord {
  const record: NotificationDeviceRecord = {
    id: `dev-${state.devices.length + 1}`,
    ownerUserId: OWNER,
    installationId: `inst-${state.devices.length + 1}`,
    platform: "android",
    provider: "fcm",
    providerToken: token,
    isActive: true,
    lastSeenAt: NOW_ISO,
    invalidatedAt: null,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  };
  state.devices.push(record);
  return record;
}

function preference(state: State, pushEnabled: boolean, emailEnabled: boolean) {
  state.preferences.push({
    id: `pref-${state.preferences.length + 1}`,
    ownerUserId: OWNER,
    notificationType: "task_reminder",
    pushEnabled,
    emailEnabled,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  });
}

function notification(state: State, type: NotificationRecord["type"] = "task_reminder"): NotificationRecord {
  const record: NotificationRecord = {
    id: `notif-${state.notifications.length + 1}`,
    ownerUserId: OWNER,
    type,
    title: "Task reminder",
    body: "You have a task reminder",
    targetType: "task",
    targetId: TASK_ID,
    idempotencyKey: `task_reminder:${state.notifications.length + 1}`,
    readAt: null,
    openedAt: null,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  };
  state.notifications.push(record);
  return record;
}

function delivery(
  state: State,
  overrides: Partial<NotificationDeliveryRecord> = {},
): NotificationDeliveryRecord {
  const base: NotificationDeliveryRecord = {
    id: `del-${state.deliveries.length + 1}`,
    notificationId: state.notifications[0]?.id ?? "missing",
    ownerUserId: OWNER,
    channel: "push",
    deviceId: state.devices[0]?.id ?? null,
    provider: "fcm",
    status: "queued",
    providerMessageId: null,
    attemptCount: 0,
    nextAttemptAt: null,
    lastErrorCode: null,
    lastErrorReason: null,
    providerAcceptedAt: null,
    failedAt: null,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  };
  const record = { ...base, ...overrides };
  state.deliveries.push(record);
  return record;
}

function createRepositories(state: State) {
  const notificationRepository = {
    async createNotification(actor: { userId: string }, input: {
      type: NotificationRecord["type"];
      title: string;
      body?: string | null;
      target?: { type: string; id: string | null } | null;
      idempotencyKey: string;
    }) {
      const existing = state.notifications.find(
        (n) => n.ownerUserId === actor.userId && n.idempotencyKey === input.idempotencyKey,
      );
      if (existing) return ok({ notification: existing, created: false });
      const record: NotificationRecord = {
        id: `notif-${++state.nextId}`,
        ownerUserId: actor.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        targetType: input.target?.type ?? null,
        targetId: input.target?.id ?? null,
        idempotencyKey: input.idempotencyKey,
        readAt: null,
        openedAt: null,
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
      };
      state.notifications.push(record);
      return ok({ notification: record, created: true });
    },
    async getNotification(actor: { userId: string }, id: string) {
      if (state.notificationReadUnavailable) return { ok: false as const, error: { code: "unknown" as const } };
      return ok(
        state.notifications.find((n) => n.id === id && n.ownerUserId === actor.userId) ?? null,
      );
    },
    async listNotifications() {
      return ok({ notifications: [], nextCursor: null });
    },
    async countUnread() {
      return ok(0);
    },
    async markRead() {
      return ok(null);
    },
    async markOpened() {
      return ok(null);
    },
    async markAllRead() {
      return ok(0);
    },
  };

  const deliveryRepository = {
    async createDeliveries(
      actor: { userId: string },
      input: {
        notificationId: string;
        deliveries: Array<{
          channel: "push" | "email";
          deviceId: string | null;
          provider: "fcm" | "resend";
          status?: "queued" | "suppressed";
          lastErrorCode?: string | null;
          lastErrorReason?: string | null;
        }>;
      },
    ) {
      const created: NotificationDeliveryRecord[] = [];
      const existing: NotificationDeliveryRecord[] = [];
      for (const d of input.deliveries) {
        const found = state.deliveries.find(
          (x) =>
            x.notificationId === input.notificationId &&
            x.channel === d.channel &&
            (x.deviceId ?? null) === (d.deviceId ?? null),
        );
        if (found) {
          existing.push(found);
          continue;
        }
        const record: NotificationDeliveryRecord = {
          id: `del-${++state.nextId}`,
          notificationId: input.notificationId,
          ownerUserId: actor.userId,
          channel: d.channel,
          deviceId: d.deviceId,
          provider: d.provider,
          status: d.status ?? "queued",
          providerMessageId: null,
          attemptCount: 0,
          nextAttemptAt: null,
          lastErrorCode: d.lastErrorCode ?? null,
          lastErrorReason: d.lastErrorReason ?? null,
          providerAcceptedAt: null,
          failedAt: null,
          createdAt: NOW_ISO,
          updatedAt: NOW_ISO,
        };
        state.deliveries.push(record);
        created.push(record);
      }
      return ok({ created, existing });
    },
    async listPending(query: { limit: number; nowIso: string }) {
      return ok(
        state.deliveries
          .filter((d) => {
            if (d.status === "queued") {
              return !d.nextAttemptAt || d.nextAttemptAt <= query.nowIso;
            }
            if (d.status === "retry_scheduled") {
              return !d.nextAttemptAt || d.nextAttemptAt <= query.nowIso;
            }
            return false;
          })
          .slice(0, query.limit),
      );
    },
    async listQueuedForNotification() {
      return ok([]);
    },
    async updateDelivery(id: string, patch: Partial<NotificationDeliveryRecord>) {
      if (state.deliveryUpdateUnavailable) return { ok: false as const, error: { code: "unknown" as const } };
      const index = state.deliveries.findIndex((d) => d.id === id);
      if (index < 0) return ok(null);
      Object.assign(state.deliveries[index]!, { ...patch, updatedAt: NOW_ISO });
      return ok(state.deliveries[index]!);
    },
    async markSending(id: string) {
      const index = state.deliveries.findIndex((d) => d.id === id);
      if (index < 0) return ok(null);
      Object.assign(state.deliveries[index]!, { status: "sending", updatedAt: NOW_ISO });
      return ok(state.deliveries[index]!);
    },
  };

  const deviceRepository = {
    async claimDevice() {
      return ok(device(state));
    },
    async getDeviceByInstallationId() {
      return ok(null);
    },
    async deactivateDevice() {
      return ok(null);
    },
    async listActiveDevices(actor: { userId: string }) {
      if (state.devicesUnavailable) return { ok: false as const, error: { code: "unknown" as const } };
      return ok(state.devices.filter((d) => d.isActive && d.ownerUserId === actor.userId));
    },
    async deactivateByToken(_ownerUserId: string, token: string) {
      state.deactivatedTokens.push(token);
      state.devices = state.devices.map((d) =>
        d.providerToken === token ? { ...d, isActive: false } : d,
      );
      return ok(undefined);
    },
  };

  const preferenceRepository = {
    async listPreferences(actor: { userId: string }) {
      if (state.preferencesUnavailable) return { ok: false as const, error: { code: "unknown" as const } };
      return ok(state.preferences.filter((p) => p.ownerUserId === actor.userId));
    },
    async upsertPreference(_actor: { userId: string }, input: {
      notificationType: NotificationPreferenceRecord["notificationType"];
      pushEnabled?: boolean;
      emailEnabled?: boolean;
    }) {
      return ok({
        id: "pref",
        ownerUserId: OWNER,
        notificationType: input.notificationType,
        pushEnabled: input.pushEnabled ?? true,
        emailEnabled: input.emailEnabled ?? true,
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
      } satisfies NotificationPreferenceRecord);
    },
  };

  const settingsRepository = {
    async getSettings() {
      if (state.settingsUnavailable) return { ok: false as const, error: { code: "unknown" as const } };
      return ok(state.settings);
    },
    async patchSettings(_actor: { userId: string }, input: {
      quietHoursEnabled?: boolean;
      quietHoursStart?: string;
      quietHoursEnd?: string;
    }) {
      const base = state.settings ?? {
        ownerUserId: OWNER,
        quietHoursEnabled: false,
        quietHoursStart: "22:00",
        quietHoursEnd: "07:00",
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
      };
      state.settings = {
        ...base,
        quietHoursEnabled: input.quietHoursEnabled ?? base.quietHoursEnabled,
        quietHoursStart: input.quietHoursStart ?? base.quietHoursStart,
        quietHoursEnd: input.quietHoursEnd ?? base.quietHoursEnd,
        updatedAt: NOW_ISO,
      };
      return ok(state.settings);
    },
  };

  const timeContextRepository: TimeContextRepository = {
    async getTimezone() {
      if (state.timeContextUnavailable) return { ok: false as const, error: { code: "unknown" as const } };
      return ok(state.timezone);
    },
    async setTimezone() {
      return ok(state.timezone ?? "UTC");
    },
  };

  const intentRepository = {
    async findDueIntents() {
      return ok(
        state.intents.map((intent) => ({ ...intent })) as TaskReminderIntentRecord[],
      );
    },
    async claimIntent(id: string, nowIso: string) {
      const intent = state.intents.find((i) => i.id === id);
      if (!intent || intent.status !== "pending") return ok(null);
      intent.status = "processing";
      void nowIso;
      return ok({ ...intent } as TaskReminderIntentRecord);
    },
    async markProcessed(id: string) {
      const intent = state.intents.find((i) => i.id === id);
      if (intent) intent.status = "processed";
      return ok(undefined);
    },
    async markFailed(id: string) {
      const intent = state.intents.find((i) => i.id === id);
      if (intent) intent.status = "failed";
      return ok(undefined);
    },
  };

  return {
    notificationRepository,
    deliveryRepository,
    deviceRepository,
    preferenceRepository,
    settingsRepository,
    timeContextRepository,
    intentRepository,
  };
}

function dueOptions(state: State, now = NOW) {
  return {
    ...createRepositories(state),
    now,
    limit: 25,
  };
}

function deliveryOptions(
  state: State,
  pushProvider: PushProvider,
  emailProvider: EmailProvider,
  now = NOW,
) {
  const repositories = createRepositories(state);
  const emailResolver: EmailDestinationResolver = {
    async resolve() {
      return "owner@example.com";
    },
  };
  return {
    ...repositories,
    pushProvider,
    emailProvider,
    emailResolver,
    now,
    limit: 25,
  };
}

test("duplicate producer trigger yields one event and one delivery per channel/device", async () => {
  const state = createState();
  const d = device(state);
  preference(state, true, true);
  state.intents.push({
    id: "reminder-1",
    ownerUserId: OWNER,
    taskId: TASK_ID,
    remindAt: NOW_ISO,
    deliveryMode: "both",
    status: "pending",
    taskTitle: "Close payroll review",
  });

  const first = await processDueTaskReminders(null, dueOptions(state));
  assert.equal(first.ok, true);
  assert.deepEqual(first.ok ? first.data : null, {
    due: 1,
    claimed: 1,
    notificationsCreated: 1,
    deliveriesQueued: 2,
    suppressed: 0,
    skipped: 0,
  });
  assert.equal(state.notifications.length, 1);
  assert.equal(state.deliveries.length, 2);
  assert.deepEqual(
    state.deliveries.map((x) => [x.channel, x.deviceId]),
    [["email", null], ["push", d.id]],
  );

  // Simulate a duplicate producer trigger that re-delivers the same intent.
  state.intents[0]!.status = "pending";
  const second = await processDueTaskReminders(null, dueOptions(state));
  assert.equal(second.ok, true);
  assert.equal(second.ok ? second.data.notificationsCreated : -1, 0);
  assert.equal(second.ok ? second.data.deliveriesQueued : -1, 0);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.deliveries.length, 2);
});

test("reclaimed legacy reminder reuses its persisted event and queues one delivery per target", async () => {
  const state = createState();
  const d = device(state);
  preference(state, true, true);
  state.intents.push({ id: "legacy-reminder", ownerUserId: OWNER, taskId: TASK_ID, remindAt: NOW_ISO, deliveryMode: "both", status: "pending", taskTitle: "Legacy" });
  state.notifications.push({ id: "legacy-notification", ownerUserId: OWNER, type: "task_reminder", title: "Task reminder", body: "Legacy", targetType: "task", targetId: TASK_ID, idempotencyKey: "task-reminder:legacy-reminder", readAt: null, openedAt: null, createdAt: NOW_ISO, updatedAt: NOW_ISO });
  const result = await processDueTaskReminders(null, dueOptions(state));
  assert.equal(result.ok, true);
  assert.equal(state.notifications.length, 1);
  assert.deepEqual(state.deliveries.map((row) => [row.notificationId, row.channel, row.deviceId]), [["legacy-notification", "email", null], ["legacy-notification", "push", d.id]]);
});

test("channel opt-out prevents delivery rows but keeps the canonical notification", async () => {
  const state = createState();
  device(state);
  preference(state, false, false);
  state.intents.push({
    id: "reminder-1",
    ownerUserId: OWNER,
    taskId: TASK_ID,
    remindAt: NOW_ISO,
    deliveryMode: "both",
    status: "pending",
    taskTitle: "Close payroll review",
  });

  const result = await processDueTaskReminders(null, dueOptions(state));
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.data.notificationsCreated : -1, 1);
  assert.equal(result.ok ? result.data.deliveriesQueued : -1, 0);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.deliveries.length, 0);
});

test("quiet hours at queue time records suppressed deliveries and no deferred queue", async () => {
  const state = createState();
  device(state);
  preference(state, true, true);
  state.timezone = "Africa/Casablanca";
  state.settings = {
    ownerUserId: OWNER,
    quietHoursEnabled: true,
    quietHoursStart: "22:00",
    quietHoursEnd: "07:00",
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  };
  state.intents.push({
    id: "reminder-1",
    ownerUserId: OWNER,
    taskId: TASK_ID,
    remindAt: NOW_ISO,
    deliveryMode: "both",
    status: "pending",
    taskTitle: "Close payroll review",
  });

  // 23:30 local in Casablanca.
  const result = await processDueTaskReminders(
    null,
    dueOptions(state, new Date("2026-01-15T22:30:00.000Z")),
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.data.deliveriesQueued : -1, 0);
  assert.equal(result.ok ? result.data.suppressed : -1, 2);
  assert.equal(state.deliveries.length, 2);
  for (const row of state.deliveries) {
    assert.equal(row.status, "suppressed");
    assert.equal(row.lastErrorCode, "quiet_hours");
    assert.equal(row.nextAttemptAt, null);
  }
});

test("transient push failure schedules a retry and exhausts to failed", async () => {
  const state = createState();
  const d = device(state);
  const n = notification(state);
  const row = delivery(state, { notificationId: n.id, deviceId: d.id });
  preference(state, true, true);

  const transient: PushProvider = {
    async send() {
      return { ok: false, errorCode: "transient", errorReason: "unavailable" };
    },
  };

  const first = await processPendingNotificationDeliveries(
    deliveryOptions(state, transient, { async send() { return { ok: true }; } }),
  );
  assert.equal(first.ok, true);
  assert.equal(first.ok ? first.data.retried : -1, 1);
  assert.equal(row.status, "retry_scheduled");
  assert.ok(row.nextAttemptAt && row.nextAttemptAt > NOW_ISO);

  // Force the final attempt.
  const mutableRow = row as unknown as {
    status: string;
    nextAttemptAt: string | null;
    attemptCount: number;
  };
  mutableRow.status = "retry_scheduled";
  mutableRow.nextAttemptAt = "2020-01-01T00:00:00.000Z";
  mutableRow.attemptCount = 5;
  const exhausted = await processPendingNotificationDeliveries(
    deliveryOptions(state, transient, { async send() { return { ok: true }; } }),
  );
  assert.equal(exhausted.ok, true);
  assert.equal(exhausted.ok ? exhausted.data.failed : -1, 1);
  assert.equal(row.status, "failed");
  assert.equal(row.nextAttemptAt, null);
});

test("terminal invalid push endpoint deactivates the device and never retries", async () => {
  const state = createState();
  const d = device(state, "dead-token");
  const n = notification(state);
  const row = delivery(state, { notificationId: n.id, deviceId: d.id });
  preference(state, true, true);

  const invalid: PushProvider = {
    async send() {
      return { ok: false, errorCode: "invalid_endpoint", errorReason: "UNREGISTERED" };
    },
  };

  const result = await processPendingNotificationDeliveries(
    deliveryOptions(state, invalid, { async send() { return { ok: true }; } }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.data.invalidated : -1, 1);
  assert.equal(row.status, "invalid_endpoint");
  assert.equal(row.nextAttemptAt, null);
  assert.deepEqual(state.deactivatedTokens, ["dead-token"]);
  assert.equal(state.devices[0]?.isActive, false);
});

test("a queued delivery re-checks opt-out and becomes suppressed without provider calls", async () => {
  const state = createState();
  const d = device(state);
  const n = notification(state);
  const row = delivery(state, { notificationId: n.id, deviceId: d.id });
  preference(state, false, true);

  let calls = 0;
  const provider: PushProvider = {
    async send() {
      calls += 1;
      return { ok: true, providerMessageId: "should-not-happen" };
    },
  };

  const result = await processPendingNotificationDeliveries(
    deliveryOptions(state, provider, { async send() { calls += 1; return { ok: true }; } }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.data.suppressed : -1, 1);
  assert.equal(row.status, "suppressed");
  assert.equal(row.lastErrorCode, "opt_out");
  assert.equal(calls, 0);
});

test("a queued delivery re-checks quiet hours and becomes suppressed without provider calls", async () => {
  const state = createState();
  const d = device(state);
  const n = notification(state);
  const row = delivery(state, { notificationId: n.id, deviceId: d.id });
  preference(state, true, true);
  state.timezone = "Africa/Casablanca";
  state.settings = {
    ownerUserId: OWNER,
    quietHoursEnabled: true,
    quietHoursStart: "22:00",
    quietHoursEnd: "07:00",
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  };

  let calls = 0;
  const provider: PushProvider = {
    async send() {
      calls += 1;
      return { ok: true, providerMessageId: "should-not-happen" };
    },
  };

  const result = await processPendingNotificationDeliveries(
    deliveryOptions(state, provider, { async send() { calls += 1; return { ok: true }; } }, new Date("2026-01-15T22:30:00.000Z")),
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.data.suppressed : -1, 1);
  assert.equal(row.status, "suppressed");
  assert.equal(row.lastErrorCode, "quiet_hours");
  assert.equal(calls, 0);
});

test("direct mention bypasses quiet hours", async () => {
  const state = createState();
  const d = device(state);
  const n = notification(state, "task_comment_mention");
  const row = delivery(state, { notificationId: n.id, deviceId: d.id });
  state.preferences.push({
    id: "pref-mention",
    ownerUserId: OWNER,
    notificationType: "task_comment_mention",
    pushEnabled: true,
    emailEnabled: true,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  });
  state.timezone = "Africa/Casablanca";
  state.settings = {
    ownerUserId: OWNER,
    quietHoursEnabled: true,
    quietHoursStart: "22:00",
    quietHoursEnd: "07:00",
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  };

  const provider: PushProvider = {
    async send() {
      return { ok: true, providerMessageId: "accepted-1" };
    },
  };

  const result = await processPendingNotificationDeliveries(
    deliveryOptions(state, provider, { async send() { return { ok: true }; } }, new Date("2026-01-15T22:30:00.000Z")),
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.data.accepted : -1, 1);
  assert.equal(row.status, "provider_accepted");
});

test("email transient retries and permanent fails explicitly", async () => {
  const stateTransient = createState();
  const nTransient = notification(stateTransient);
  const emailTransient = delivery(stateTransient, {
    notificationId: nTransient.id,
    channel: "email",
    deviceId: null,
    provider: "resend",
  });
  preference(stateTransient, true, true);
  const transientResult = await processPendingNotificationDeliveries(
    deliveryOptions(
      stateTransient,
      { async send() { return { ok: true, providerMessageId: "unused" }; } },
      { async send() { return { ok: false, errorCode: "transient", errorReason: "429" }; } },
    ),
  );
  assert.equal(transientResult.ok, true);
  assert.equal(transientResult.ok ? transientResult.data.retried : -1, 1);
  assert.equal(emailTransient.status, "retry_scheduled");

  const statePermanent = createState();
  const nPermanent = notification(statePermanent);
  const emailPermanent = delivery(statePermanent, {
    notificationId: nPermanent.id,
    channel: "email",
    deviceId: null,
    provider: "resend",
  });
  preference(statePermanent, true, true);
  const permanentResult = await processPendingNotificationDeliveries(
    deliveryOptions(
      statePermanent,
      { async send() { return { ok: true, providerMessageId: "unused" }; } },
      { async send() { return { ok: false, errorCode: "permanent", errorReason: "invalid from" }; } },
    ),
  );
  assert.equal(permanentResult.ok, true);
  assert.equal(permanentResult.ok ? permanentResult.data.failed : -1, 1);
  assert.equal(emailPermanent.status, "failed");
});

test("suppressed rows are never returned by the pending query", async () => {
  const state = createState();
  const n = notification(state);
  delivery(state, { notificationId: n.id, status: "suppressed", lastErrorCode: "quiet_hours" });
  const repositories = createRepositories(state);
  const pending = await repositories.deliveryRepository.listPending({ limit: 25, nowIso: NOW_ISO });
  assert.equal(pending.ok, true);
  assert.equal(pending.ok ? pending.value.length : -1, 0);
});

test("private finance events persist and push generic copy with no amount/merchant", async () => {
  const state = createState();
  const d = device(state);
  const repositories = createRepositories(state);

  const created = await createNotification(
    ACTOR,
    repositories.notificationRepository as never,
    {
      type: "money_threshold",
      title: "Spent $4,312 at Acme Motors",
      body: "Account ending 9911 crossed your $3,000 threshold at Acme Motors.",
      target: { type: "money", id: "33333333-3333-3333-3333-333333333333" },
      idempotencyKey: "money_threshold:evt-1",
    },
  );
  assert.equal(created.ok, true);

  const persisted = state.notifications[0]!;
  assert.equal(persisted.title, "Finance update");
  assert.equal(persisted.targetType, "money");
  assert.doesNotMatch(persisted.body ?? "", /4,?312|Acme|9911|3,?000/i);

  delivery(state, { notificationId: persisted.id, deviceId: d.id });
  delivery(state, {
    notificationId: persisted.id,
    channel: "email",
    deviceId: null,
    provider: "resend",
  });

  const captures: Array<{ title: string; body: string | null; data: Record<string, string> }> = [];
  const emailCaptures: Array<{ subject: string; html: string }> = [];
  const provider: PushProvider = {
    async send(payload) {
      captures.push({ title: payload.title, body: payload.body, data: payload.data });
      return { ok: true, providerMessageId: "push-1" };
    },
  };

  const result = await processPendingNotificationDeliveries(
    deliveryOptions(state, provider, {
      async send({ subject, html }) {
        emailCaptures.push({ subject, html });
        return { ok: true, providerMessageId: "email-1" };
      },
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.data.accepted : -1, 2);
  const captured = captures[0];
  assert.ok(captured);
  assert.equal(captured.title, "Finance update");
  assert.doesNotMatch(captured.body ?? "", /4,?312|Acme|9911|3,?000/i);
  assert.doesNotMatch(JSON.stringify(captured.data), /4,?312|Acme|9911|3,?000/i);

  const email = emailCaptures[0];
  assert.ok(email);
  assert.match(email.subject, /^Finance update$/);
  assert.doesNotMatch(email.html, /4,?312|Acme|9911|3,?000/i);
});

test("queue-time preference read failure leaves the intent retryable with no fan-out", async () => {
  const state = createState({ preferencesUnavailable: true });
  device(state);
  state.intents.push({
    id: "reminder-1",
    ownerUserId: OWNER,
    taskId: TASK_ID,
    remindAt: NOW_ISO,
    deliveryMode: "both",
    status: "pending",
    taskTitle: "Close payroll review",
  });

  const result = await processDueTaskReminders(null, dueOptions(state));
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.data.skipped : -1, 1);
  assert.equal(result.ok ? result.data.notificationsCreated : -1, 0);
  assert.equal(result.ok ? result.data.deliveriesQueued : -1, 0);
  assert.equal(state.notifications.length, 0);
  assert.equal(state.deliveries.length, 0);
  // Claimed but never marked processed, so lease reclaim can retry.
  assert.equal(state.intents[0]!.status, "processing");
});

test("queue-time quiet-hours read failure creates the event and queued deliveries; dispatch fails closed", async () => {
  const state = createState({ settingsUnavailable: true });
  device(state);
  preference(state, true, true);
  state.intents.push({
    id: "reminder-1",
    ownerUserId: OWNER,
    taskId: TASK_ID,
    remindAt: NOW_ISO,
    deliveryMode: "both",
    status: "pending",
    taskTitle: "Close payroll review",
  });

  const result = await processDueTaskReminders(null, dueOptions(state));
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.data.notificationsCreated : -1, 1);
  assert.equal(result.ok ? result.data.deliveriesQueued : -1, 2);
  assert.equal(result.ok ? result.data.suppressed : -1, 0);
  assert.equal(result.ok ? result.data.skipped : -1, 0);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.deliveries.length, 2);
  for (const row of state.deliveries) {
    assert.equal(row.status, "queued");
  }
  assert.equal(state.intents[0]!.status, "processed");

  // Dispatch is authoritative and fails closed on the same settings outage.
  let calls = 0;
  const provider: PushProvider = {
    async send() {
      calls += 1;
      return { ok: true, providerMessageId: "should-not-happen" };
    },
  };
  const dispatchResult = await processPendingNotificationDeliveries(
    deliveryOptions(state, provider, { async send() { calls += 1; return { ok: true }; } }),
  );
  assert.equal(dispatchResult.ok, true);
  assert.equal(dispatchResult.ok ? dispatchResult.data.retried : -1, 2);
  assert.equal(calls, 0);
  for (const row of state.deliveries) {
    assert.equal(row.status, "retry_scheduled");
    assert.equal(row.lastErrorCode, "quiet_hours_unavailable");
  }
});

test("live task producer routes through the canonical use case (non-UUID target degrades)", async () => {
  const state = createState();
  device(state);
  preference(state, true, true);
  state.intents.push({
    id: "reminder-1",
    ownerUserId: OWNER,
    taskId: "not-a-uuid",
    remindAt: NOW_ISO,
    deliveryMode: "both",
    status: "pending",
    taskTitle: "Close payroll review",
  });

  const result = await processDueTaskReminders(null, dueOptions(state));
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.data.notificationsCreated : -1, 1);
  // The raw repository call would have persisted target_type='task' with a
  // non-UUID id and failed at the uuid column; the use case degrades safely.
  assert.equal(state.notifications[0]!.targetType, null);
  assert.equal(state.notifications[0]!.targetId, null);
});

test("dispatch preference read failure defers without provider calls", async () => {
  const state = createState({ preferencesUnavailable: true });
  const d = device(state);
  const n = notification(state);
  const row = delivery(state, { notificationId: n.id, deviceId: d.id });

  let calls = 0;
  const provider: PushProvider = {
    async send() {
      calls += 1;
      return { ok: true, providerMessageId: "should-not-happen" };
    },
  };

  const result = await processPendingNotificationDeliveries(
    deliveryOptions(state, provider, { async send() { calls += 1; return { ok: true }; } }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.data.retried : -1, 1);
  assert.equal(row.status, "retry_scheduled");
  assert.equal(row.lastErrorCode, "preferences_unavailable");
  assert.ok(row.nextAttemptAt);
  assert.equal(calls, 0);

  // Exhaust the bounded retry budget: the same deferral becomes terminal with
  // an actionable error code instead of silently sending.
  const mutableRow = row as unknown as {
    status: string;
    nextAttemptAt: string | null;
    attemptCount: number;
  };
  mutableRow.status = "retry_scheduled";
  mutableRow.nextAttemptAt = "2020-01-01T00:00:00.000Z";
  mutableRow.attemptCount = 5;

  const exhausted = await processPendingNotificationDeliveries(
    deliveryOptions(state, provider, { async send() { calls += 1; return { ok: true }; } }),
  );
  assert.equal(exhausted.ok, true);
  assert.equal(exhausted.ok ? exhausted.data.failed : -1, 1);
  assert.equal(row.status, "failed");
  assert.equal(row.lastErrorCode, "preferences_unavailable");
  assert.equal(row.nextAttemptAt, null);
  assert.equal(calls, 0);
});

test("dispatch quiet-hours settings read failure defers without provider calls", async () => {
  const state = createState({ settingsUnavailable: true });
  const d = device(state);
  const n = notification(state);
  const row = delivery(state, { notificationId: n.id, deviceId: d.id });
  preference(state, true, true);

  let calls = 0;
  const provider: PushProvider = {
    async send() {
      calls += 1;
      return { ok: true, providerMessageId: "should-not-happen" };
    },
  };

  const result = await processPendingNotificationDeliveries(
    deliveryOptions(state, provider, { async send() { calls += 1; return { ok: true }; } }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.data.retried : -1, 1);
  assert.equal(row.status, "retry_scheduled");
  assert.equal(row.lastErrorCode, "quiet_hours_unavailable");
  assert.equal(calls, 0);
});

test("dispatch time-context read failure defers without provider calls", async () => {
  const state = createState({ timeContextUnavailable: true });
  const d = device(state);
  const n = notification(state);
  const row = delivery(state, { notificationId: n.id, deviceId: d.id });
  preference(state, true, true);
  state.settings = {
    ownerUserId: OWNER,
    quietHoursEnabled: true,
    quietHoursStart: "22:00",
    quietHoursEnd: "07:00",
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  };

  let calls = 0;
  const provider: PushProvider = {
    async send() {
      calls += 1;
      return { ok: true, providerMessageId: "should-not-happen" };
    },
  };

  const result = await processPendingNotificationDeliveries(
    deliveryOptions(state, provider, { async send() { calls += 1; return { ok: true }; } }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.data.retried : -1, 1);
  assert.equal(row.status, "retry_scheduled");
  assert.equal(row.lastErrorCode, "quiet_hours_unavailable");
  assert.equal(calls, 0);
});

test("missing notification_settings table degrades to legacy quiet-hours-disabled behavior", async () => {
  // The repository maps a missing table (0079 not applied) to ok(null).
  const state = createState({ settings: null });
  device(state);
  preference(state, true, true);
  state.intents.push({
    id: "reminder-1",
    ownerUserId: OWNER,
    taskId: TASK_ID,
    remindAt: NOW_ISO,
    deliveryMode: "both",
    status: "pending",
    taskTitle: "Close payroll review",
  });

  const result = await processDueTaskReminders(null, dueOptions(state));
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.data.notificationsCreated : -1, 1);
  assert.equal(result.ok ? result.data.deliveriesQueued : -1, 2);
  assert.equal(result.ok ? result.data.suppressed : -1, 0);
  assert.equal(result.ok ? result.data.skipped : -1, 0);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.deliveries.length, 2);
  for (const row of state.deliveries) {
    assert.equal(row.status, "queued");
  }
  assert.equal(state.intents[0]!.status, "processed");
});

test("queue-time device read failure skips the intent instead of silently dropping push", async () => {
  const state = createState({ devicesUnavailable: true });
  device(state);
  preference(state, true, true);
  state.intents.push({
    id: "reminder-1",
    ownerUserId: OWNER,
    taskId: TASK_ID,
    remindAt: NOW_ISO,
    deliveryMode: "both",
    status: "pending",
    taskTitle: "Close payroll review",
  });

  const result = await processDueTaskReminders(null, dueOptions(state));
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.data.skipped : -1, 1);
  assert.equal(state.deliveries.length, 0);
  // Event may already exist idempotently, but the intent must remain retryable.
  assert.equal(state.intents[0]!.status, "processing");
});

test("notification read failure defers without provider calls; null notification is terminal", async () => {
  const state = createState({ notificationReadUnavailable: true });
  const d = device(state);
  const n = notification(state);
  const row = delivery(state, { notificationId: n.id, deviceId: d.id });
  preference(state, true, true);

  let calls = 0;
  const provider: PushProvider = {
    async send() {
      calls += 1;
      return { ok: true, providerMessageId: "should-not-happen" };
    },
  };

  const deferred = await processPendingNotificationDeliveries(
    deliveryOptions(state, provider, { async send() { calls += 1; return { ok: true }; } }),
  );
  assert.equal(deferred.ok, true);
  assert.equal(deferred.ok ? deferred.data.retried : -1, 1);
  assert.equal(row.status, "retry_scheduled");
  assert.equal(row.lastErrorCode, "notification_unavailable");
  assert.equal(calls, 0);

  // A null notification (not a read failure) is terminal.
  const missingState = createState();
  const missingDevice = device(missingState);
  const missingRow = delivery(missingState, { notificationId: "does-not-exist", deviceId: missingDevice.id });
  preference(missingState, true, true);
  const missing = await processPendingNotificationDeliveries(
    deliveryOptions(missingState, provider, { async send() { calls += 1; return { ok: true }; } }),
  );
  assert.equal(missing.ok, true);
  assert.equal(missing.ok ? missing.data.failed : -1, 1);
  assert.equal(missingRow.status, "failed");
  assert.equal(missingRow.lastErrorCode, "missing_notification");
  assert.equal(calls, 0);
});

test("deferral persistence failure is reported honestly and left to stale-lease reclaim", async () => {
  const state = createState({
    preferencesUnavailable: true,
    deliveryUpdateUnavailable: true,
  });
  const d = device(state);
  const n = notification(state);
  const row = delivery(state, { notificationId: n.id, deviceId: d.id });

  let calls = 0;
  const provider: PushProvider = {
    async send() {
      calls += 1;
      return { ok: true, providerMessageId: "should-not-happen" };
    },
  };

  const result = await processPendingNotificationDeliveries(
    deliveryOptions(state, provider, { async send() { calls += 1; return { ok: true }; } }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.data.retried : -1, 0);
  assert.equal(result.ok ? result.data.failed : -1, 0);
  assert.equal(result.ok ? result.data.persistenceErrors : -1, 1);
  assert.equal(row.status, "sending");
  assert.equal(calls, 0);
});

test("failed suppression write reports persistenceErrors and leaves the row reclaimable", async () => {
  const state = createState({ deliveryUpdateUnavailable: true });
  const d = device(state);
  const n = notification(state);
  const row = delivery(state, { notificationId: n.id, deviceId: d.id });
  // Push is opted out; the suppression write itself fails.
  preference(state, false, true);

  let calls = 0;
  const provider: PushProvider = {
    async send() {
      calls += 1;
      return { ok: true, providerMessageId: "should-not-happen" };
    },
  };

  const result = await processPendingNotificationDeliveries(
    deliveryOptions(state, provider, { async send() { calls += 1; return { ok: true }; } }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.data.suppressed : -1, 0);
  assert.equal(result.ok ? result.data.persistenceErrors : -1, 1);
  assert.equal(row.status, "sending");
  assert.equal(calls, 0);
});

test("device lookup failure defers without sends or deactivation and exhausts to failed", async () => {
  const state = createState({ devicesUnavailable: true });
  const d = device(state);
  const n = notification(state);
  const row = delivery(state, { notificationId: n.id, deviceId: d.id });
  preference(state, true, true);

  let calls = 0;
  const provider: PushProvider = {
    async send() {
      calls += 1;
      return { ok: true, providerMessageId: "should-not-happen" };
    },
  };

  const result = await processPendingNotificationDeliveries(
    deliveryOptions(state, provider, { async send() { calls += 1; return { ok: true }; } }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.data.retried : -1, 1);
  assert.equal(row.status, "retry_scheduled");
  assert.equal(row.lastErrorCode, "device_lookup_unavailable");
  assert.ok(row.nextAttemptAt);
  assert.equal(calls, 0);
  assert.deepEqual(state.deactivatedTokens, []);

  const mutableRow = row as unknown as {
    status: string;
    nextAttemptAt: string | null;
    attemptCount: number;
  };
  mutableRow.status = "retry_scheduled";
  mutableRow.nextAttemptAt = "2020-01-01T00:00:00.000Z";
  mutableRow.attemptCount = 5;

  const exhausted = await processPendingNotificationDeliveries(
    deliveryOptions(state, provider, { async send() { calls += 1; return { ok: true }; } }),
  );
  assert.equal(exhausted.ok, true);
  assert.equal(exhausted.ok ? exhausted.data.failed : -1, 1);
  assert.equal(row.status, "failed");
  assert.equal(row.lastErrorCode, "device_lookup_unavailable");
  assert.equal(row.nextAttemptAt, null);
  assert.equal(calls, 0);
  assert.deepEqual(state.deactivatedTokens, []);
});

test("successful empty device lookup remains a terminal invalid endpoint", async () => {
  const state = createState();
  const n = notification(state);
  const row = delivery(state, { notificationId: n.id, deviceId: "missing-device" });
  preference(state, true, true);

  let calls = 0;
  const provider: PushProvider = {
    async send() {
      calls += 1;
      return { ok: true, providerMessageId: "should-not-happen" };
    },
  };

  const result = await processPendingNotificationDeliveries(
    deliveryOptions(state, provider, { async send() { calls += 1; return { ok: true }; } }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.data.invalidated : -1, 1);
  assert.equal(row.status, "invalid_endpoint");
  assert.equal(row.lastErrorCode, "missing_token");
  assert.equal(calls, 0);
});

test("enabled quiet hours with no/invalid owner timezone defer instead of sending", async () => {
  for (const timezone of [null, "Not/AZone"] as const) {
    const state = createState({ timezone });
    const d = device(state);
    const n = notification(state);
    const row = delivery(state, { notificationId: n.id, deviceId: d.id });
    preference(state, true, true);
    state.settings = {
      ownerUserId: OWNER,
      quietHoursEnabled: true,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    };

    let calls = 0;
    const provider: PushProvider = {
      async send() {
        calls += 1;
        return { ok: true, providerMessageId: "should-not-happen" };
      },
    };

    const result = await processPendingNotificationDeliveries(
      deliveryOptions(state, provider, { async send() { calls += 1; return { ok: true }; } }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.data.retried : -1, 1);
    assert.equal(row.status, "retry_scheduled");
    assert.equal(row.lastErrorCode, "quiet_hours_unavailable");
    assert.equal(calls, 0);
  }
});

test("disabled quiet hours with missing timezone keep legacy send behavior", async () => {
  const state = createState({ timezone: null });
  const d = device(state);
  const n = notification(state);
  const row = delivery(state, { notificationId: n.id, deviceId: d.id });
  preference(state, true, true);
  state.settings = {
    ownerUserId: OWNER,
    quietHoursEnabled: false,
    quietHoursStart: "22:00",
    quietHoursEnd: "07:00",
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  };

  const provider: PushProvider = {
    async send() {
      return { ok: true, providerMessageId: "accepted-1" };
    },
  };

  const result = await processPendingNotificationDeliveries(
    deliveryOptions(state, provider, { async send() { return { ok: true }; } }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.data.accepted : -1, 1);
  assert.equal(row.status, "provider_accepted");
});

test("critical direct mention bypasses enabled quiet hours with missing timezone", async () => {
  const state = createState({ timezone: null });
  const d = device(state);
  const n = notification(state, "task_comment_mention");
  const row = delivery(state, { notificationId: n.id, deviceId: d.id });
  state.preferences.push({
    id: "pref-mention",
    ownerUserId: OWNER,
    notificationType: "task_comment_mention",
    pushEnabled: true,
    emailEnabled: true,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  });
  state.settings = {
    ownerUserId: OWNER,
    quietHoursEnabled: true,
    quietHoursStart: "22:00",
    quietHoursEnd: "07:00",
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  };

  const provider: PushProvider = {
    async send() {
      return { ok: true, providerMessageId: "accepted-1" };
    },
  };

  const result = await processPendingNotificationDeliveries(
    deliveryOptions(state, provider, { async send() { return { ok: true }; } }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.data.accepted : -1, 1);
  assert.equal(row.status, "provider_accepted");
});

test("non-token provider classifications never deactivate the device", async () => {
  for (const classification of ["transient", "auth", "permanent"] as const) {
    const state = createState();
    const d = device(state);
    const n = notification(state);
    const row = delivery(state, { notificationId: n.id, deviceId: d.id });
    preference(state, true, true);

    const provider: PushProvider = {
      async send() {
        return { ok: false, errorCode: classification, errorReason: "provider failure" };
      },
    };

    const result = await processPendingNotificationDeliveries(
      deliveryOptions(state, provider, { async send() { return { ok: true }; } }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.data.invalidated : -1, 0);
    assert.deepEqual(state.deactivatedTokens, []);
    assert.notEqual(row.status, "invalid_endpoint");
  }
});

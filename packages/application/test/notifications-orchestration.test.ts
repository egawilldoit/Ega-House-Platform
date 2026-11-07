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
    targetId: "task-1",
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
      return ok(state.settings);
    },
    async upsertSettings(_actor: { userId: string }, input: {
      quietHoursEnabled: boolean;
      quietHoursStart: string;
      quietHoursEnd: string;
    }) {
      state.settings = {
        ownerUserId: OWNER,
        quietHoursEnabled: input.quietHoursEnabled,
        quietHoursStart: input.quietHoursStart,
        quietHoursEnd: input.quietHoursEnd,
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
      };
      return ok(state.settings);
    },
  };

  const timeContextRepository: TimeContextRepository = {
    async getTimezone() {
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
    taskId: "task-1",
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

test("channel opt-out prevents delivery rows but keeps the canonical notification", async () => {
  const state = createState();
  device(state);
  preference(state, false, false);
  state.intents.push({
    id: "reminder-1",
    ownerUserId: OWNER,
    taskId: "task-1",
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
    taskId: "task-1",
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
  assert.equal(result.ok ? result.data.deliveriesQueued : -1, 2);
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
      target: { type: "money", id: "budget-1" },
      idempotencyKey: "money_threshold:evt-1",
    },
  );
  assert.equal(created.ok, true);

  const persisted = state.notifications[0]!;
  assert.equal(persisted.title, "Finance update");
  assert.doesNotMatch(persisted.body ?? "", /4,?312|Acme|9911|3,?000/i);

  delivery(state, { notificationId: persisted.id, deviceId: d.id });

  const captures: Array<{ title: string; body: string | null; data: Record<string, string> }> = [];
  const provider: PushProvider = {
    async send(payload) {
      captures.push({ title: payload.title, body: payload.body, data: payload.data });
      return { ok: true, providerMessageId: "push-1" };
    },
  };

  const result = await processPendingNotificationDeliveries(
    deliveryOptions(state, provider, { async send() { return { ok: true }; } }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.data.accepted : -1, 1);
  const captured = captures[0];
  assert.ok(captured);
  assert.equal(captured.title, "Finance update");
  assert.doesNotMatch(captured.body ?? "", /4,?312|Acme|9911|3,?000/i);
  assert.doesNotMatch(JSON.stringify(captured.data), /4,?312|Acme|9911|3,?000/i);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTaskReminderEmail,
  deliverTaskReminderEmails,
} from "./task-reminder-delivery-service";

type MockReminder = {
  id: string;
  owner_user_id: string;
  task_id: string;
  remind_at: string;
  channel: string;
  status: string;
  sent_at: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
  tasks: {
    id: string;
    title: string;
    status: string;
    priority: string;
    due_date: string | null;
    planned_for_date: string | null;
    projects: { name: string | null; slug: string | null } | null;
  } | null;
};

function reminder(overrides?: Partial<MockReminder>): MockReminder {
  return {
    id: "reminder-1",
    owner_user_id: "user-1",
    task_id: "task-1",
    remind_at: "2026-05-04T09:00:00.000Z",
    channel: "email",
    status: "pending",
    sent_at: null,
    failure_reason: null,
    created_at: "2026-05-04T08:00:00.000Z",
    updated_at: "2026-05-04T08:00:00.000Z",
    tasks: {
      id: "task-1",
      title: "Close payroll review",
      status: "todo",
      priority: "urgent",
      due_date: "2026-05-05",
      planned_for_date: "2026-05-04",
      projects: { name: "Ops", slug: "ops" },
    },
    ...overrides,
  };
}

function createDeliveryMock(options?: {
  reminders?: MockReminder[];
  sendError?: unknown;
  throwSendError?: unknown;
  staleClaimIds?: string[];
}) {
  const reminders = [...(options?.reminders ?? [reminder()])];
  const sendCalls: Array<{ from: string; to: string; subject: string; html: string }> = [];
  const updateCalls: Array<{ payload: Record<string, unknown>; filters: Record<string, string> }> = [];
  const selectFilters: Record<string, string> = {};
  const staleClaimIds = new Set(options?.staleClaimIds ?? []);

  function matchesFilters(item: MockReminder, filters: Record<string, string>) {
    return Object.entries(filters).every(([column, value]) => {
      if (column === "id") return item.id === value;
      if (column === "status") return item.status === value;
      if (column === "channel") return item.channel === value;
      if (column === "owner_user_id") return item.owner_user_id === value;
      throw new Error(`Unexpected filter: ${column}`);
    });
  }

  const supabase = {
    from(table: string) {
      assert.equal(table, "task_reminders");

      return {
        select() {
          const state = {
            filters: {} as Record<string, string>,
            remindAtLte: null as string | null,
          };

          const chain = {
            eq(column: string, value: string) {
              state.filters[column] = value;
              selectFilters[column] = value;
              return chain;
            },
            lte(column: string, value: string) {
              assert.equal(column, "remind_at");
              state.remindAtLte = value;
              return chain;
            },
            order(column: string, orderOptions?: { ascending?: boolean }) {
              assert.equal(column, "remind_at");
              assert.equal(orderOptions?.ascending, true);
              return chain;
            },
            async limit(count: number) {
              assert.equal(count, 25);
              return {
                data: reminders
                  .filter((item) => matchesFilters(item, state.filters))
                  .filter((item) =>
                    state.remindAtLte ? item.remind_at <= state.remindAtLte : true,
                  )
                  .sort((a, b) => a.remind_at.localeCompare(b.remind_at))
                  .slice(0, count),
                error: null,
              };
            },
          };

          return chain;
        },
        update(payload: Record<string, unknown>) {
          const state = { filters: {} as Record<string, string> };

          const chain = {
            eq(column: string, value: string) {
              state.filters[column] = value;
              return chain;
            },
            select() {
              return {
                async maybeSingle() {
                  updateCalls.push({ payload, filters: { ...state.filters } });

                  if (
                    payload.status === "processing" &&
                    state.filters.id &&
                    staleClaimIds.has(state.filters.id)
                  ) {
                    return { data: null, error: null };
                  }

                  const index = reminders.findIndex((item) => matchesFilters(item, state.filters));
                  if (index < 0) {
                    return { data: null, error: null };
                  }

                  reminders[index] = {
                    ...reminders[index],
                    status: String(payload.status ?? reminders[index].status),
                    sent_at:
                      typeof payload.sent_at === "string"
                        ? payload.sent_at
                        : reminders[index].sent_at,
                    failure_reason:
                      payload.failure_reason === undefined
                        ? reminders[index].failure_reason
                        : (payload.failure_reason as string | null),
                    updated_at: String(payload.updated_at ?? reminders[index].updated_at),
                  };

                  return { data: reminders[index], error: null };
                },
              };
            },
          };

          return chain;
        },
      };
    },
  };

  const resend = {
    emails: {
      async send(input: { from: string; to: string; subject: string; html: string }) {
        sendCalls.push(input);

        if (options?.throwSendError) {
          throw options.throwSendError;
        }

        if (options?.sendError) {
          return { data: null, error: options.sendError };
        }

        return { data: { id: "email-1" }, error: null };
      },
    },
  };

  return {
    supabase: supabase as never,
    resend,
    reminders,
    sendCalls,
    updateCalls,
    selectFilters,
  };
}

test("deliverTaskReminderEmails filters due pending email reminders for the owner", async () => {
  const mock = createDeliveryMock({
    reminders: [
      reminder({ id: "due", remind_at: "2026-05-04T08:59:00.000Z" }),
      reminder({ id: "future", remind_at: "2026-05-04T09:01:00.000Z" }),
      reminder({ id: "sms", channel: "sms" }),
      reminder({ id: "failed", status: "failed" }),
      reminder({ id: "other-owner", owner_user_id: "user-2" }),
    ],
  });

  const result = await deliverTaskReminderEmails({
    supabase: mock.supabase,
    resend: mock.resend,
    from: "from@example.com",
    to: "to@example.com",
    ownerUserId: "user-1",
    now: new Date("2026-05-04T09:00:00.000Z"),
    appUrl: "https://app.example.com",
  });

  assert.deepEqual(result.counts, { due: 1, claimed: 1, sent: 1, failed: 0, skipped: 0 });
  assert.equal(mock.sendCalls.length, 1);
  assert.equal(mock.sendCalls[0]?.subject, "Task reminder: Close payroll review");
  assert.equal(mock.selectFilters.status, "pending");
  assert.equal(mock.selectFilters.channel, "email");
  assert.equal(mock.selectFilters.owner_user_id, "user-1");
});

test("buildTaskReminderEmail includes task context and direct task URL", () => {
  const email = buildTaskReminderEmail(reminder(), "https://app.example.com");

  assert.match(email.subject, /Close payroll review/);
  assert.match(email.html, /Ops/);
  assert.match(email.html, /2026-05-05/);
  assert.match(email.html, /2026-05-04/);
  assert.match(email.html, /urgent/);
  assert.match(email.html, /https:\/\/app\.example\.com\/tasks\/projects\/ops#task-task-1/);
});

test("deliverTaskReminderEmails marks successful deliveries as sent", async () => {
  const mock = createDeliveryMock();

  const result = await deliverTaskReminderEmails({
    supabase: mock.supabase,
    resend: mock.resend,
    from: "from@example.com",
    to: "to@example.com",
    now: new Date("2026-05-04T09:00:00.000Z"),
    appUrl: "https://app.example.com",
  });

  assert.deepEqual(result.counts, { due: 1, claimed: 1, sent: 1, failed: 0, skipped: 0 });
  assert.equal(mock.reminders[0]?.status, "sent");
  assert.equal(mock.reminders[0]?.sent_at, "2026-05-04T09:00:00.000Z");
  assert.deepEqual(
    mock.updateCalls.map((call) => call.payload.status),
    ["processing", "sent"],
  );
});

test("deliverTaskReminderEmails marks send failures as failed", async () => {
  const mock = createDeliveryMock({ sendError: { message: "resend down" } });

  const result = await deliverTaskReminderEmails({
    supabase: mock.supabase,
    resend: mock.resend,
    from: "from@example.com",
    to: "to@example.com",
    now: new Date("2026-05-04T09:00:00.000Z"),
  });

  assert.deepEqual(result.counts, { due: 1, claimed: 1, sent: 0, failed: 1, skipped: 0 });
  assert.equal(mock.reminders[0]?.status, "failed");
  assert.match(mock.reminders[0]?.failure_reason ?? "", /resend down/);
});

test("deliverTaskReminderEmails marks thrown send failures as failed", async () => {
  const mock = createDeliveryMock({ throwSendError: new Error("network down") });

  const result = await deliverTaskReminderEmails({
    supabase: mock.supabase,
    resend: mock.resend,
    from: "from@example.com",
    to: "to@example.com",
    now: new Date("2026-05-04T09:00:00.000Z"),
  });

  assert.deepEqual(result.counts, { due: 1, claimed: 1, sent: 0, failed: 1, skipped: 0 });
  assert.equal(mock.reminders[0]?.status, "failed");
  assert.match(mock.reminders[0]?.failure_reason ?? "", /network down/);
});

test("deliverTaskReminderEmails skips cancelled reminders", async () => {
  const mock = createDeliveryMock({
    reminders: [reminder({ id: "cancelled", status: "cancelled" })],
  });

  const result = await deliverTaskReminderEmails({
    supabase: mock.supabase,
    resend: mock.resend,
    from: "from@example.com",
    to: "to@example.com",
    now: new Date("2026-05-04T09:00:00.000Z"),
  });

  assert.deepEqual(result.counts, { due: 0, claimed: 0, sent: 0, failed: 0, skipped: 0 });
  assert.equal(mock.sendCalls.length, 0);
  assert.equal(mock.reminders[0]?.status, "cancelled");
});

test("deliverTaskReminderEmails skips send when claim loses duplicate race", async () => {
  const mock = createDeliveryMock({ staleClaimIds: ["reminder-1"] });

  const result = await deliverTaskReminderEmails({
    supabase: mock.supabase,
    resend: mock.resend,
    from: "from@example.com",
    to: "to@example.com",
    now: new Date("2026-05-04T09:00:00.000Z"),
  });

  assert.deepEqual(result.counts, { due: 1, claimed: 0, sent: 0, failed: 0, skipped: 1 });
  assert.equal(mock.sendCalls.length, 0);
  assert.equal(mock.reminders[0]?.status, "pending");
});

test("deliverTaskReminderEmails does not double-send on repeat invoke", async () => {
  const mock = createDeliveryMock();

  const firstResult = await deliverTaskReminderEmails({
    supabase: mock.supabase,
    resend: mock.resend,
    from: "from@example.com",
    to: "to@example.com",
    now: new Date("2026-05-04T09:00:00.000Z"),
  });
  const secondResult = await deliverTaskReminderEmails({
    supabase: mock.supabase,
    resend: mock.resend,
    from: "from@example.com",
    to: "to@example.com",
    now: new Date("2026-05-04T09:00:30.000Z"),
  });

  assert.deepEqual(firstResult.counts, { due: 1, claimed: 1, sent: 1, failed: 0, skipped: 0 });
  assert.deepEqual(secondResult.counts, { due: 0, claimed: 0, sent: 0, failed: 0, skipped: 0 });
  assert.equal(mock.sendCalls.length, 1);
  assert.equal(mock.reminders[0]?.status, "sent");
});

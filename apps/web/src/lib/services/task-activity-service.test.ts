import assert from "node:assert/strict";
import test from "node:test";

import { describeTaskActivity, getTaskActivity } from "./task-activity-service";

test("status, archive and field changes get honest human summaries", () => {
  assert.equal(
    describeTaskActivity({ kind: "status", fromStatus: "todo", toStatus: "in_progress" }),
    "Status changed from todo to in progress",
  );
  assert.equal(describeTaskActivity({ kind: "created" }), "Task created");
  assert.equal(describeTaskActivity({ kind: "archived" }), "Task archived");
  assert.equal(describeTaskActivity({ kind: "restored" }), "Task restored");
  assert.equal(
    describeTaskActivity({
      kind: "field_change",
      delta: { priority: { from: "medium", to: "high" } },
    }),
    "Priority: medium → high",
  );
  assert.equal(
    describeTaskActivity({ kind: "field_change", delta: { title: { from: "a", to: "b" } } }),
    "Title edited",
  );
  assert.equal(describeTaskActivity({ kind: "field_change", delta: {} }), "Task updated");
});

function stubClient(rows: {
  status?: Array<Record<string, unknown>>;
  fields?: Array<Record<string, unknown>>;
  sessions?: Array<Record<string, unknown>>;
}) {
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "owner-1" } }, error: null }) },
    from(table: string) {
      const data =
        table === "task_status_events"
          ? rows.status ?? []
          : table === "task_activity_events"
            ? rows.fields ?? []
            : rows.sessions ?? [];
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        in() {
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return Promise.resolve({ data, error: null });
        },
      };
      return query;
    },
  };
  return client;
}

test("unions ledgers and sessions in deterministic newest-first order", async () => {
  const client = stubClient({
    status: [
      {
        id: "s1",
        from_status: "todo",
        to_status: "in_progress",
        occurred_at: "2026-10-27T10:00:00.000Z",
      },
    ],
    fields: [
      {
        id: "f1",
        actor_kind: "system",
        actor_label: null,
        event_kind: "field_change",
        delta: { priority: { from: "medium", to: "high" } },
        occurred_at: "2026-10-27T11:00:00.000Z",
      },
    ],
    sessions: [
      { id: "x1", started_at: "2026-10-27T09:00:00.000Z", ended_at: null },
    ],
  });

  const page = await getTaskActivity("t1", { supabase: client as never, limit: 10 });
  assert.equal(page.errorMessage, null);
  assert.deepEqual(
    page.items.map((item) => item.kind),
    ["field_change", "status", "session"],
  );
  assert.equal(page.items[0]?.actor.kind, "system");
});

test("agent attribution and reminder rows come from the stored actor columns", async () => {
  const client = stubClient({
    status: [
      {
        id: "s1",
        from_status: "todo",
        to_status: "in_progress",
        occurred_at: "2026-10-27T10:00:00.000Z",
        actor_kind: "agent",
        actor_agent_id: "mcp-client-a",
        actor_label: "Hermes",
      },
    ],
    fields: [
      {
        id: "f1",
        actor_kind: "agent",
        actor_agent_id: "mcp-client-a",
        actor_label: "Hermes",
        event_kind: "reminder_scheduled",
        delta: { remind_at: { to: "2026-11-10T09:00:00.000Z" } },
        occurred_at: "2026-10-27T09:00:00.000Z",
      },
    ],
    sessions: [],
  });

  const page = await getTaskActivity("t1", { supabase: client as never, limit: 10 });
  assert.equal(page.errorMessage, null);
  assert.deepEqual(
    page.items.map((item) => item.actor.kind),
    ["agent", "agent"],
  );
  assert.equal(page.items[0]?.actor.agentId, "mcp-client-a");
  assert.equal(page.items[0]?.actor.label, "Hermes");
  assert.equal(page.items[1]?.summary, "Reminder set for Nov 10, 2026");
});

test("ties on the same instant are ordered by stable id", async () => {  const at = "2026-10-27T10:00:00.000Z";
  const client = stubClient({
    status: [{ id: "b", from_status: null, to_status: "done", occurred_at: at }],
    fields: [
      {
        id: "a",
        actor_kind: "owner",
        actor_label: null,
        event_kind: "created",
        delta: {},
        occurred_at: at,
      },
    ],
    sessions: [],
  });

  const page = await getTaskActivity("t1", { supabase: client as never, limit: 10 });
  assert.deepEqual(page.items.map((item) => item.id), ["status-b", "field-a"]);
});

test("pagination slices the merged order and reports more rows", async () => {
  const rows = Array.from({ length: 4 }, (_, index) => ({
    id: `f${index}`,
    actor_kind: "owner",
    actor_label: null,
    event_kind: "field_change",
    delta: {},
    occurred_at: `2026-10-27T1${index}:00:00.000Z`,
  }));
  const client = stubClient({ fields: rows, status: [], sessions: [] });

  const page = await getTaskActivity("t1", { supabase: client as never, limit: 2, offset: 1 });
  assert.deepEqual(page.items.map((item) => item.id), ["field-f2", "field-f1"]);
  assert.equal(page.hasMore, true);
});

test("an unauthenticated read returns no rows", async () => {
  const client = stubClient({});
  client.auth.getUser = async () =>
    ({ data: { user: null }, error: null }) as unknown as ReturnType<typeof client.auth.getUser>;
  const page = await getTaskActivity("t1", { supabase: client as never });
  assert.deepEqual(page.items, []);
  assert.equal(page.errorMessage, "Task was not found.");
});

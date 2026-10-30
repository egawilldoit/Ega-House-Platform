import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTaskActivity,
  describeTaskActivity,
  latestTaskActivity,
  paginateTaskActivity,
  taskActivityActorFromColumns,
  taskActivityEventKindFromColumn,
} from "../src/tasks/activity-read-model";

const ownerActor = { kind: "owner" as const, userId: "owner-1" };
const agentActor = {
  kind: "agent" as const,
  agentId: "mcp-client-a",
  label: "Hermes",
};

test("activity summaries name the change without inventing detail", () => {
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
  assert.equal(
    describeTaskActivity({
      kind: "reminder_scheduled",
      delta: { remind_at: { to: "2026-11-10T09:00:00.000Z" } },
    }),
    "Reminder set for Nov 10, 2026",
  );
  assert.equal(describeTaskActivity({ kind: "reminder_cancelled" }), "Reminder cancelled");
  assert.equal(describeTaskActivity({ kind: "comment" }), "Comment added");
  assert.equal(describeTaskActivity({ kind: "field_change", delta: {} }), "Task updated");
});

test("actor columns keep honest provenance and reject malformed kinds", () => {
  assert.deepEqual(
    taskActivityActorFromColumns({ actor_kind: "owner", actor_user_id: "user-1" }),
    { kind: "owner", userId: "user-1", label: null },
  );
  assert.deepEqual(
    taskActivityActorFromColumns({
      actor_kind: "agent",
      actor_agent_id: "mcp-client-a",
      actor_label: "Hermes",
    }),
    { kind: "agent", userId: null, agentId: "mcp-client-a", label: "Hermes" },
  );
  assert.deepEqual(taskActivityActorFromColumns({ actor_kind: "system" }), { kind: "system" });
  assert.deepEqual(taskActivityActorFromColumns({ actor_kind: null }), { kind: "unknown" });
  assert.deepEqual(taskActivityActorFromColumns({ actor_kind: "forged" }), { kind: "unknown" });
});

test("event kind columns are narrowed instead of trusted", () => {
  assert.equal(taskActivityEventKindFromColumn("comment"), "comment");
  assert.equal(taskActivityEventKindFromColumn("reminder_scheduled"), "reminder_scheduled");
  assert.equal(taskActivityEventKindFromColumn("not-a-kind"), null);
});

test("sources merge newest first with a stable id tie-break", () => {
  const at = "2026-10-27T10:00:00.000Z";
  const items = buildTaskActivity({
    statusEvents: [
      {
        id: "b",
        fromStatus: null,
        toStatus: "done",
        occurredAt: at,
        actor: ownerActor,
      },
    ],
    ledgerEvents: [
      {
        id: "a",
        kind: "created",
        occurredAt: at,
        actor: agentActor,
        delta: {},
      },
      {
        id: "c",
        kind: "field_change",
        occurredAt: "2026-10-27T11:00:00.000Z",
        actor: ownerActor,
        delta: { priority: { from: "low", to: "high" } },
      },
    ],
    sessions: [
      {
        id: "s1",
        startedAt: "2026-10-27T09:00:00.000Z",
        endedAt: null,
        actor: { kind: "unknown" },
      },
    ],
  });

  assert.deepEqual(
    items.map((item) => item.id),
    ["field-c", "status-b", "field-a", "session-s1"],
  );
  assert.equal(items[0]?.actor.kind, "owner");
  assert.equal(items[1]?.actor.kind, "owner");
});

test("duplicate stable ids cannot double-count when a source is merged twice", () => {
  const source = {
    id: "same",
    kind: "comment" as const,
    occurredAt: "2026-10-27T10:00:00.000Z",
    actor: agentActor,
    delta: {},
  };
  const items = buildTaskActivity({ ledgerEvents: [source, source] });
  assert.equal(items.length, 1);
  assert.equal(items[0]?.kind, "comment");
});

test("pagination is deterministic and reports older rows honestly", () => {
  const ledgerEvents = Array.from({ length: 5 }, (_, index) => ({
    id: `f${index}`,
    kind: "field_change" as const,
    occurredAt: `2026-10-27T1${index}:00:00.000Z`,
    actor: ownerActor,
    delta: {},
  }));

  const merged = buildTaskActivity({ ledgerEvents });
  const first = paginateTaskActivity(merged, { limit: 2 });
  assert.deepEqual(first.items.map((item) => item.id), ["field-f4", "field-f3"]);
  assert.equal(first.hasMore, true);

  const second = paginateTaskActivity(merged, { limit: 2, offset: 2 });
  assert.deepEqual(second.items.map((item) => item.id), ["field-f2", "field-f1"]);
  assert.equal(second.hasMore, true);

  const last = paginateTaskActivity(merged, { limit: 2, offset: 4 });
  assert.deepEqual(last.items.map((item) => item.id), ["field-f0"]);
  assert.equal(last.hasMore, false);
});

test("project rows take the latest global rows, not one source's head", () => {
  const items = latestTaskActivity(
    {
      statusEvents: [
        {
          id: "old-status",
          fromStatus: "todo",
          toStatus: "in_progress",
          occurredAt: "2026-10-01T10:00:00.000Z",
          actor: ownerActor,
        },
      ],
      ledgerEvents: [
        {
          id: "new-field",
          kind: "field_change",
          occurredAt: "2026-10-02T10:00:00.000Z",
          actor: agentActor,
          delta: {},
        },
      ],
    },
    1,
  );
  assert.deepEqual(items.map((item) => item.id), ["field-new-field"]);
});

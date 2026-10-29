import assert from "node:assert/strict";
import test from "node:test";

import {
  TASK_FIELD_PATCH_FIELDS,
  buildTaskFieldPatchInput,
  isTaskFieldPatchField,
  updateTaskFieldForOwner,
} from "./task-service";

const CURRENT = {
  title: "Draft review",
  description: "Existing body",
  status: "in_progress",
  priority: "high",
  start_date: null,
  due_date: "2026-05-01",
  estimate_minutes: 75,
  blocked_reason: null,
};

test("accepts exactly the whitelisted fields", () => {
  assert.deepEqual([...TASK_FIELD_PATCH_FIELDS], [
    "title",
    "description",
    "status",
    "priority",
    "startDate",
    "dueDate",
    "estimateMinutes",
    "blockedReason",
  ]);
  for (const field of TASK_FIELD_PATCH_FIELDS) {
    assert.equal(isTaskFieldPatchField(field), true);
  }
  for (const field of ["recurrenceRule", "projectId", "scheduledStartAt", ""]) {
    assert.equal(isTaskFieldPatchField(field), false);
  }
});

test("changes only the requested field and carries the rest forward", () => {
  const result = buildTaskFieldPatchInput("task-1", CURRENT, "status", "blocked");
  assert.ok("input" in result);
  assert.equal(result.input.taskId, "task-1");
  assert.equal(result.input.status, "blocked");
  assert.equal(result.input.priority, "high");
  assert.equal(result.input.dueDate, "2026-05-01");
  assert.equal(result.input.estimateMinutes, 75);
  // A non-title patch must not carry the title: updateTaskInline rewrites every
  // field it receives.
  assert.equal(result.input.title, undefined);
  assert.equal(result.input.blockedReason, null);
  // An unrelated patch must not rewrite the description either.
  assert.equal(result.input.description, undefined);
});

test("a description patch changes only the description", () => {
  const result = buildTaskFieldPatchInput("task-1", CURRENT, "description", "New body");
  assert.ok("input" in result);
  assert.equal(result.input.description, "New body");
  assert.equal(result.input.title, undefined);
  assert.equal(result.input.status, "in_progress");
  assert.equal(result.input.priority, "high");
  assert.equal(result.input.dueDate, "2026-05-01");
});

test("a title patch changes the title and keeps the rest", () => {
  const result = buildTaskFieldPatchInput("task-1", CURRENT, "title", "Renamed");
  assert.ok("input" in result);
  assert.equal(result.input.title, "Renamed");
  assert.equal(result.input.status, "in_progress");
  assert.equal(result.input.priority, "high");
});

test("a priority patch keeps status, due date and estimate intact", () => {
  const result = buildTaskFieldPatchInput("task-1", CURRENT, "priority", "low");
  assert.ok("input" in result);
  assert.equal(result.input.priority, "low");
  assert.equal(result.input.status, "in_progress");
  assert.equal(result.input.dueDate, "2026-05-01");
  assert.equal(result.input.estimateMinutes, 75);
});

test("a null due date stays empty rather than becoming the string 'null'", () => {
  const result = buildTaskFieldPatchInput(
    "task-1",
    { ...CURRENT, due_date: null },
    "priority",
    "medium",
  );
  assert.ok("input" in result);
  assert.equal(result.input.dueDate, "");
});

test("rejects a non-whitelisted field without building an input", () => {
  const result = buildTaskFieldPatchInput("task-1", CURRENT, "projectId", "project-2");
  assert.ok(!("input" in result));
  assert.equal(result.errorMessage, "Unsupported task field update.");
});

// ---------------------------------------------------------------------------
// updateTaskFieldForOwner — authorization and pre-mutation rejection
// ---------------------------------------------------------------------------

type MaybeRow = Record<string, unknown> | null;

function stubClient(
  row: MaybeRow,
  options: {
    userId?: string | null;
    error?: unknown;
    /** Result of the guarded write; null models a lost concurrency check. */
    writeRow?: MaybeRow;
  } = {},
) {
  const filters: Array<{ column: string; value: unknown }> = [];
  const writeFilters: Array<{ column: string; value: unknown }> = [];
  const userId = options.userId === undefined ? "owner-1" : options.userId;
  const client = {
    auth: {
      getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
    from(table: string) {
      if (table !== "tasks") {
        // Post-write side effects (calendar sync queue) are outside this test.
        const noop: Record<string, unknown> = {};
        noop.eq = () => noop;
        noop.select = () => noop;
        noop.maybeSingle = async () => ({ data: null, error: null });
        noop.insert = async () => ({ error: null });
        noop.delete = () => noop;
        return noop;
      }
      return {
        select() {
          const query = {
            eq(column: string, value: unknown) {
              filters.push({ column, value });
              return query;
            },
            async maybeSingle() {
              return { data: row, error: options.error ?? null };
            },
          };
          return query;
        },
        update() {
          const query = {
            eq(column: string, value: unknown) {
              writeFilters.push({ column, value });
              return query;
            },
            select() {
              return {
                async maybeSingle() {
                  return { data: options.writeRow ?? null, error: null };
                },
              };
            },
          };
          return query;
        },
      };
    },
  };
  return { client, filters, writeFilters };
}

test("rejects a non-whitelisted field before touching the database", async () => {
  const { client, filters } = stubClient({});
  const result = await updateTaskFieldForOwner(
    { taskId: "task-1", field: "projectId", value: "project-2" },
    { supabase: client as never },
  );
  assert.deepEqual(result, { errorMessage: "Unsupported task field update." });
  assert.deepEqual(filters, []);
});

test("scopes the read to the authenticated owner", async () => {
  const { client, filters } = stubClient(null);
  const result = await updateTaskFieldForOwner(
    { taskId: "task-1", field: "status", value: "done" },
    { supabase: client as never },
  );
  assert.equal(result.errorMessage, "Task was not found or is no longer available.");
  assert.deepEqual(filters, [
    { column: "id", value: "task-1" },
    { column: "owner_user_id", value: "owner-1" },
  ]);
});

test("an unknown id and a missing session report the same message", async () => {
  const unknown = stubClient(null);
  const noSession = stubClient(null, { userId: null });

  const a = await updateTaskFieldForOwner(
    { taskId: "task-1", field: "status", value: "done" },
    { supabase: unknown.client as never },
  );
  const b = await updateTaskFieldForOwner(
    { taskId: "task-1", field: "status", value: "done" },
    { supabase: noSession.client as never },
  );

  assert.deepEqual(a, b);
  assert.deepEqual(noSession.filters, []);
});

test("a load failure is reported as an error, not as a missing task", async () => {
  const { client } = stubClient(null, { error: { message: "statement timeout" } });
  const result = await updateTaskFieldForOwner(
    { taskId: "task-1", field: "status", value: "done" },
    { supabase: client as never },
  );
  assert.deepEqual(result, { errorMessage: "Unable to load task right now." });
});

test("an invalid value is rejected by the shared validator before any write", async () => {
  const { client } = stubClient({
    title: "Draft review",
    status: "in_progress",
    priority: "high",
    due_date: null,
    estimate_minutes: null,
    blocked_reason: null,
  });
  const result = await updateTaskFieldForOwner(
    { taskId: "task-1", field: "priority", value: "catastrophic" },
    { supabase: client as never },
  );
  assert.ok(result.errorMessage);
  assert.notEqual(result.errorMessage, null);
});

test("a single-field write is guarded by the updated_at it read", async () => {
  const { client, writeFilters } = stubClient(
    {
      title: "Draft review",
      description: null,
      status: "in_progress",
      priority: "high",
      due_date: null,
      estimate_minutes: null,
      blocked_reason: null,
      updated_at: "2026-05-01T10:00:00.000Z",
    },
    { writeRow: { id: "task-1" } },
  );

  const result = await updateTaskFieldForOwner(
    { taskId: "task-1", field: "title", value: "Renamed" },
    { supabase: client as never },
  );

  assert.equal(result.errorMessage, null);
  // The guarded update must carry both the row identity and the revision it
  // read; later side-effect writes are allowed to add their own predicates.
  assert.deepEqual(writeFilters.slice(0, 2), [
    { column: "id", value: "task-1" },
    { column: "updated_at", value: "2026-05-01T10:00:00.000Z" },
  ]);
});

test("a concurrent change is reported instead of silently reverting fields", async () => {
  const { client } = stubClient(
    {
      title: "Draft review",
      description: null,
      status: "in_progress",
      priority: "high",
      due_date: null,
      estimate_minutes: null,
      blocked_reason: null,
      updated_at: "2026-05-01T10:00:00.000Z",
    },
    { writeRow: null },
  );

  const result = await updateTaskFieldForOwner(
    { taskId: "task-1", field: "title", value: "Renamed" },
    { supabase: client as never },
  );

  assert.equal(result.errorMessage, "This task changed since you opened it. Reload and try again.");
});

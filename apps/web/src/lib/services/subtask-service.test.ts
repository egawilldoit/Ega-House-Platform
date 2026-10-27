import assert from "node:assert/strict";
import test from "node:test";

import {
  addTaskSubtask,
  listTaskSubtasks,
  setTaskSubtaskDone,
} from "./subtask-service";

function stubClient(options: {
  userId?: string | null;
  taskOwned?: boolean;
  subtasks?: Array<Record<string, unknown>>;
  inserted?: Array<Record<string, unknown>>;
} = {}) {
  const userId = options.userId === undefined ? "owner-1" : options.userId;
  const inserted = options.inserted ?? [];

  const client = {
    auth: {
      getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
    from(table: string) {
      if (table === "tasks") {
        return {
          select() {
            const q = {
              eq() {
                return q;
              },
              async maybeSingle() {
                return { data: options.taskOwned === false ? null : { id: "t1" }, error: null };
              },
            };
            return q;
          },
        };
      }

      return {
        select() {
          const q = {
            eq() {
              return q;
            },
            async order() {
              return { data: options.subtasks ?? [], error: null };
            },
            async maybeSingle() {
              return { data: options.subtasks?.[0] ?? null, error: null };
            },
          };
          return q;
        },
        insert(row: Record<string, unknown>) {
          inserted.push(row);
          const q = {
            select() {
              return {
                async maybeSingle() {
                  return {
                    data: {
                      id: "s1",
                      task_id: row.task_id,
                      title: row.title,
                      done: false,
                      position: row.position,
                      completed_at: null,
                      created_at: "2026-10-27T10:00:00.000Z",
                      updated_at: "2026-10-27T10:00:00.000Z",
                    },
                    error: null,
                  };
                },
              };
            },
          };
          return q;
        },
        update(row: Record<string, unknown>) {
          const q = {
            eq() {
              return q;
            },
            select() {
              return {
                async maybeSingle() {
                  return {
                    data: {
                      id: "s1",
                      task_id: "t1",
                      title: "Existing",
                      done: row.done,
                      position: 0,
                      completed_at: row.completed_at ?? null,
                      created_at: "2026-10-27T10:00:00.000Z",
                      updated_at: "2026-10-27T10:00:00.000Z",
                    },
                    error: null,
                  };
                },
              };
            },
          };
          return q;
        },
      };
    },
  };

  return { client, inserted };
}

test("refuses to add a subtask to a task the caller does not own", async () => {
  const { client, inserted } = stubClient({ taskOwned: false });
  const result = await addTaskSubtask(
    { taskId: "t1", title: "Forged" },
    { supabase: client as never },
  );

  assert.equal(result.data, null);
  assert.match(result.errorMessage ?? "", /not found/i);
  assert.equal(inserted.length, 0);
});

test("adds a normalized title at the next position", async () => {
  const { client, inserted } = stubClient();
  const result = await addTaskSubtask(
    { taskId: "t1", title: "  Write   the plan " },
    { supabase: client as never },
  );

  assert.equal(result.errorMessage, null);
  assert.equal(inserted[0]?.title, "Write the plan");
  assert.equal(inserted[0]?.position, 0);
  assert.equal(inserted[0]?.task_id, "t1");
});

test("rejects a blank subtask title before writing", async () => {
  const { client, inserted } = stubClient();
  const result = await addTaskSubtask(
    { taskId: "t1", title: "   " },
    { supabase: client as never },
  );

  assert.match(result.errorMessage ?? "", /required/i);
  assert.equal(inserted.length, 0);
});

test("toggling done stamps completed_at and clearing removes it", async () => {
  const { client } = stubClient();
  const done = await setTaskSubtaskDone(
    { subtaskId: "s1", done: true },
    { supabase: client as never },
  );
  assert.ok(done.data?.completedAt);

  const reopened = await setTaskSubtaskDone(
    { subtaskId: "s1", done: false },
    { supabase: client as never },
  );
  assert.equal(reopened.data?.completedAt, null);
});

test("lists checklist items in position order and maps the wire shape", async () => {
  const { client } = stubClient({
    subtasks: [
      {
        id: "s1",
        task_id: "t1",
        title: "First",
        done: true,
        position: 0,
        completed_at: "2026-10-27T10:00:00.000Z",
        created_at: "2026-10-27T09:00:00.000Z",
        updated_at: "2026-10-27T10:00:00.000Z",
      },
    ],
  });

  const result = await listTaskSubtasks("t1", { supabase: client as never });
  assert.equal(result.errorMessage, null);
  assert.deepEqual(result.data?.[0], {
    id: "s1",
    taskId: "t1",
    title: "First",
    done: true,
    position: 0,
    completedAt: "2026-10-27T10:00:00.000Z",
    createdAt: "2026-10-27T09:00:00.000Z",
    updatedAt: "2026-10-27T10:00:00.000Z",
  });
});

test("an unauthenticated caller sees no checklist", async () => {
  const { client } = stubClient({ userId: null });
  const result = await listTaskSubtasks("t1", { supabase: client as never });
  assert.equal(result.data, null);
});

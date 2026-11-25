import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  archiveTask,
  createTaskEmailReminder,
  deleteTaskSafely,
  getTaskById,
  updateTaskFieldForOwner,
  updateTaskInline,
} from "@/lib/services/task-service";

/**
 * Owner isolation through the real web task services.
 *
 * The fake Supabase below models the request-scoped RLS boundary: every read
 * and write is filtered to the session user's `owner_user_id`, exactly as the
 * database policy does for the cookie-bound anon client. Task A cannot see or
 * mutate Task B's row, and no mutation is attempted when the row is hidden.
 */

type Row = Record<string, unknown>;

const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";

type TableName = "tasks" | "task_sessions" | "task_reminders" | "task_recurrences" | "calendar_sync_jobs";

type FakeDb = Record<TableName, Row[]>;

function createDb(): FakeDb {
  return {
    tasks: [
      {
        id: "task-a",
        owner_user_id: USER_A,
        title: "Task A",
        description: null,
        blocked_reason: null,
        status: "todo",
        priority: "medium",
        start_date: null,
        due_date: null,
        planned_for_date: null,
        scheduled_start_at: null,
        scheduled_end_at: null,
        calendar_sync_enabled: false,
        calendar_reminder_minutes: 10,
        estimate_minutes: null,
        completed_at: null,
        archived_at: null,
        archived_by: null,
        focus_rank: null,
        board_rank: null,
        project_id: "project-1",
        goal_id: null,
        calendar_event_id: null,
        updated_at: "2026-11-20T10:00:00.000Z",
        created_at: "2026-11-01T00:00:00.000Z",
        projects: { name: "Platform", slug: "platform" },
        goals: null,
      },
      {
        id: "task-b",
        owner_user_id: USER_B,
        title: "Task B",
        description: null,
        blocked_reason: null,
        status: "todo",
        priority: "medium",
        start_date: null,
        due_date: null,
        planned_for_date: null,
        scheduled_start_at: null,
        scheduled_end_at: null,
        calendar_sync_enabled: false,
        calendar_reminder_minutes: 10,
        estimate_minutes: null,
        completed_at: null,
        archived_at: null,
        archived_by: null,
        focus_rank: null,
        board_rank: null,
        project_id: "project-2",
        goal_id: null,
        calendar_event_id: null,
        updated_at: "2026-11-20T10:00:00.000Z",
        created_at: "2026-11-01T00:00:00.000Z",
        projects: { name: "Side", slug: null },
        goals: null,
      },
    ],
    task_sessions: [],
    task_reminders: [],
    task_recurrences: [],
    calendar_sync_jobs: [],
  };
}

class FakeQuery {
  private readonly filters: Array<{ column: string; value: unknown; kind: "eq" | "in" | "is" }> = [];
  private mutation: "update" | "delete" | "insert" | null = null;
  private payload: Row | null = null;
  private selectHead = false;
  private limitCount: number | null = null;

  constructor(
    private readonly db: FakeDb,
    private readonly table: TableName,
    private readonly sessionUserId: string,
  ) {}

  select(_columns?: unknown, options?: { count?: string; head?: boolean }) {
    this.selectHead = Boolean(options?.head);
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, value, kind: "eq" });
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push({ column, value: values, kind: "in" });
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push({ column, value, kind: "is" });
    return this;
  }

  neq() {
    return this;
  }

  not() {
    return this;
  }

  or() {
    return this;
  }

  lt() {
    return this;
  }

  gt() {
    return this;
  }

  gte() {
    return this;
  }

  lte() {
    return this;
  }

  ilike() {
    return this;
  }

  order() {
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  update(payload: Row) {
    this.mutation = "update";
    this.payload = payload;
    return this;
  }

  delete() {
    this.mutation = "delete";
    return this;
  }

  insert(payload: Row | Row[]) {
    this.mutation = "insert";
    this.payload = Array.isArray(payload) ? payload[0] ?? {} : payload;
    return this;
  }

  upsert(payload: Row) {
    return this.insert(payload);
  }

  private visibleRows(): Row[] {
    // RLS: only the session owner's rows are addressable.
    let rows = this.db[this.table].filter((row) => row.owner_user_id === this.sessionUserId);
    for (const filter of this.filters) {
      if (filter.column === "owner_user_id") {
        // Explicit owner filters can only narrow the RLS-visible set.
        rows = rows.filter((row) => row.owner_user_id === filter.value);
      } else if (filter.kind === "eq") {
        rows = rows.filter((row) => row[filter.column] === filter.value);
      } else if (filter.kind === "in") {
        rows = rows.filter((row) => (filter.value as unknown[]).includes(row[filter.column]));
      } else if (filter.kind === "is") {
        rows = rows.filter((row) => (row[filter.column] ?? null) === filter.value);
      }
    }
    if (this.limitCount !== null) rows = rows.slice(0, this.limitCount);
    return rows;
  }

  private applyMutation(): { data: Row | Row[] | null; error: null; count?: number } {
    if (this.mutation === "insert") {
      const inserted = {
        id: `generated-${this.db[this.table].length + 1}`,
        owner_user_id: this.sessionUserId,
        created_at: "2026-11-20T11:00:00.000Z",
        updated_at: "2026-11-20T11:00:00.000Z",
        sent_at: null,
        failure_reason: null,
        ...this.payload,
      };
      this.db[this.table].push(inserted);
      return { data: inserted, error: null };
    }
    const rows = this.visibleRows();
    if (this.mutation === "update") {
      const changed: Row[] = [];
      for (const row of rows) {
        for (const [key, value] of Object.entries(this.payload ?? {})) {
          if (value !== undefined) row[key] = value;
        }
        changed.push(row);
      }
      return { data: changed[0] ?? null, error: null };
    }
    if (this.mutation === "delete") {
      for (const row of rows) {
        const index = this.db[this.table].indexOf(row);
        if (index >= 0) this.db[this.table].splice(index, 1);
      }
      return { data: null, error: null };
    }
    const selected = this.visibleRows();
    return this.selectHead
      ? { data: null, error: null, count: selected.length }
      : { data: selected, error: null };
  }

  async maybeSingle() {
    const result = this.applyMutation();
    const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
    if (this.mutation === "update") {
      return { data: rows[0] ?? null, error: null };
    }
    if (this.mutation === "insert") {
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows[0] ?? null, error: null };
  }

  async single() {
    return this.maybeSingle();
  }

  then<TResult1, TResult2>(
    fulfilled?: ((value: { data: unknown; error: null; count?: number }) => TResult1 | PromiseLike<TResult1>) | null,
    rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.applyMutation()).then(fulfilled, rejected);
  }
}

function createRlsClient(db: FakeDb, userId: string) {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: userId } }, error: null }),
    },
    async rpc(name: string, args: Row) {
      expect(name).toBe("calendar_sync_enqueue_job");
      expect(args.p_owner_user_id).toBe(userId);
      db.calendar_sync_jobs.push({
        owner_user_id: args.p_owner_user_id,
        task_id: args.p_task_id,
        operation: args.p_operation,
      });
      return { data: null, error: null };
    },
    from(table: string) {
      return new FakeQuery(db, table as TableName, userId);
    },
  } as never;
}

describe("task service owner isolation", () => {
  it("does not read another owner's task", async () => {
    const db = createDb();
    const resultA = await getTaskById("task-b", { supabase: createRlsClient(db, USER_A) });
    expect(resultA).toEqual({ errorMessage: null, data: null });

    const resultB = await getTaskById("task-b", { supabase: createRlsClient(db, USER_B) });
    expect(resultB.data?.id).toBe("task-b");
  });

  it("does not update another owner's task through the field patch path", async () => {
    const db = createDb();
    const result = await updateTaskFieldForOwner(
      { taskId: "task-b", field: "status", value: "done" },
      { supabase: createRlsClient(db, USER_A) },
    );

    expect(result.errorMessage).toBe("Task was not found or is no longer available.");
    expect(db.tasks.find((task) => task.id === "task-b")?.status).toBe("todo");
  });

  it("does not write another owner's task through the inline update seam", async () => {
    const db = createDb();
    const result = await updateTaskInline(
      {
        taskId: "task-b",
        status: "done",
        priority: "medium",
        dueDate: null,
        estimateMinutes: null,
        blockedReason: null,
      },
      { supabase: createRlsClient(db, USER_A) },
    );

    expect(result.errorMessage).toBe("Task was not found or is no longer available.");
    expect(db.tasks.find((task) => task.id === "task-b")?.status).toBe("todo");
  });

  it("does not archive another owner's task", async () => {
    const db = createDb();
    const result = await archiveTask("task-b", { supabase: createRlsClient(db, USER_A) });

    expect(result.errorMessage).toBe("Task was not found or is no longer available.");
    expect(db.tasks.find((task) => task.id === "task-b")?.archived_at).toBeNull();
  });

  it("does not delete another owner's task", async () => {
    const db = createDb();
    const result = await deleteTaskSafely("task-b", { supabase: createRlsClient(db, USER_A) });

    expect(result.errorMessage).toBe("Task was not found or is no longer available.");
    expect(db.tasks.some((task) => task.id === "task-b")).toBe(true);
  });

  it("does not attach a reminder to another owner's task", async () => {
    const db = createDb();
    const result = await createTaskEmailReminder(
      {
        taskId: "task-b",
        remindAt: "2026-12-01T09:00:00.000Z",
        timezone: "UTC",
      },
      { supabase: createRlsClient(db, USER_A), now: new Date("2026-11-20T00:00:00.000Z") },
    );

    expect(result).toEqual({
      errorMessage: "Task was not found or is no longer available.",
      data: null,
    });
    expect(db.task_reminders).toHaveLength(0);
  });

  it("still permits the owner to read and mutate their own task", async () => {
    const db = createDb();
    const client = createRlsClient(db, USER_A);

    expect((await getTaskById("task-a", { supabase: client })).data?.id).toBe("task-a");
    expect(
      (
        await updateTaskFieldForOwner(
          { taskId: "task-a", field: "priority", value: "high" },
          { supabase: client },
        )
      ).errorMessage,
    ).toBeNull();
    expect(db.tasks.find((task) => task.id === "task-a")?.priority).toBe("high");

    expect(
      (
        await archiveTask("task-a", {
          supabase: client,
          updatedAtIso: "2026-11-21T09:00:00.000Z",
        })
      ).errorMessage,
    ).toBeNull();
    expect(db.tasks.find((task) => task.id === "task-a")?.archived_at).toBe(
      "2026-11-21T09:00:00.000Z",
    );
    expect(db.calendar_sync_jobs).toEqual([
      { owner_user_id: USER_A, task_id: "task-a", operation: "delete" },
    ]);
  });

  it("keeps task mutation modules on the request-scoped server client", () => {
    const servicePath = path.resolve(
      process.cwd(),
      "src/lib/services/task-service.ts",
    );
    const source = readFileSync(servicePath, "utf8");

    // No service-role/admin client can bypass the owner policy in a task
    // mutation path; every query goes through the cookie-bound server client.
    expect(source).not.toMatch(/service_role|SERVICE_ROLE|createServiceClient|createAdminClient/);
    expect(source).toContain('import { createClient } from "@/lib/supabase/server"');
  });
});

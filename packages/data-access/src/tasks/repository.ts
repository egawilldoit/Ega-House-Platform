import type {
  AuthenticatedActor,
  CreateTaskRecordInput,
  RepositoryResult,
  TaskGoalOptionRecord,
  TaskProjectOptionRecord,
  TaskQuery,
  TaskRecord,
  TaskRecurrenceRecord,
  TaskRecurrenceSchedule,
  TaskReminderRecord,
  TaskScopeRecord,
  TaskStatus,
  TasksRepository,
  UpdateTaskRecordInput,
} from "@ega/application";
import {
  taskViewFromLegacyInput,
  type TaskViewDefinition,
  type TaskViewFilter,
} from "@ega/contracts/common/task-list";
import type { TaskRecurrenceRule } from "@ega/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isSupabaseUniqueConstraintViolation,
  mcpOperationIdentity,
  sanitizeSupabaseError,
} from "../supabase/errors";

/**
 * Hard ceiling on rows fetched for one list request. The adapter pages up to
 * this bound so a filtered view is not silently limited to the first
 * PostgREST page; `countTasks` supplies the exact total for truncation labels.
 */
const TASK_LIST_ROW_CAP = 5000;
const TASK_LIST_PAGE_SIZE = 500;

const TASK_SELECT = [
  "id",
  "title",
  "description",
  "blocked_reason",
  "status",
  "priority",
  "due_date",
  "estimate_minutes",
  "project_id",
  "goal_id",
  "planned_for_date",
  "focus_rank",
  "board_rank",
  "scheduled_start_at",
  "scheduled_end_at",
  "calendar_sync_enabled",
  "calendar_reminder_minutes",
  "completed_at",
  "archived_at",
  "created_at",
  "updated_at",
  "projects(name, slug)",
  "goals(title)",
].join(",");

const REMINDER_SELECT =
  "id,task_id,remind_at,channel,delivery_mode,status,sent_at,failure_reason,source,source_id,created_at,updated_at";
const RECURRENCE_SELECT = "id,task_id,rule,anchor_date,timezone,next_occurrence_date,last_generated_at";
const SESSION_TOTAL_SELECT = "task_id,duration_seconds";

type Row = Record<string, unknown>;

function asRows(value: unknown): Row[] {
  return (value ?? []) as Row[];
}

function asRow(value: unknown): Row {
  return value as Row;
}

function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" ? value : value === null || value === undefined ? null : Number(value);
}

function mapReminder(row: Row): TaskReminderRecord {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    remindAt: String(row.remind_at),
    channel: "email",
    deliveryMode: (String(row.delivery_mode ?? "email") as TaskReminderRecord["deliveryMode"]) ?? "email",
    status: String(row.status) as TaskReminderRecord["status"],
    sentAt: asNullableString(row.sent_at),
    failureReason: asNullableString(row.failure_reason),
    source: asNullableString(row.source),
    sourceId: asNullableString(row.source_id),
    createdAt: asNullableString(row.created_at) ?? undefined,
    updatedAt: asNullableString(row.updated_at) ?? undefined,
  };
}

function mapRecurrence(row: Row): TaskRecurrenceRecord {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    rule: String(row.rule) as TaskRecurrenceRule,
    anchorDate: String(row.anchor_date),
    timezone: String(row.timezone),
    nextOccurrenceDate: String(row.next_occurrence_date),
    lastGeneratedAt: asNullableString(row.last_generated_at),
  };
}

function mapTask(
  row: Row,
  reminders: TaskReminderRecord[] = [],
  recurrence: TaskRecurrenceRecord | null = null,
  totalDurationSeconds = 0,
): TaskRecord {
  const projects = row.projects as { name?: string | null; slug?: string | null } | null | undefined;
  const goals = row.goals as { title?: string | null } | null | undefined;
  return {
    id: String(row.id),
    title: String(row.title),
    description: asNullableString(row.description),
    blockedReason: asNullableString(row.blocked_reason),
    status: String(row.status) as TaskRecord["status"],
    priority: String(row.priority) as TaskRecord["priority"],
    dueDate: asNullableString(row.due_date),
    estimateMinutes: asNullableNumber(row.estimate_minutes),
    projectId: String(row.project_id),
    goalId: asNullableString(row.goal_id),
    plannedForDate: asNullableString(row.planned_for_date),
    focusRank: asNullableNumber(row.focus_rank),
    boardRank: asNullableString(row.board_rank),
    archivedAt: asNullableString(row.archived_at),
    updatedAt: String(row.updated_at),
    reminders,
    recurrence,
    scheduledStartAt: asNullableString(row.scheduled_start_at),
    scheduledEndAt: asNullableString(row.scheduled_end_at),
    calendarSyncEnabled: Boolean(row.calendar_sync_enabled),
    calendarReminderMinutes: Number(row.calendar_reminder_minutes ?? 10),
    completedAt: asNullableString(row.completed_at),
    createdAt: asNullableString(row.created_at) ?? undefined,
    projectName: projects?.name ?? null,
    projectSlug: projects?.slug ?? null,
    goalTitle: goals?.title ?? null,
    totalDurationSeconds,
  };
}

function failure<T>(error: { code?: string; message?: string } | null): RepositoryResult<T> {
  return { ok: false, error: sanitizeSupabaseError(error) };
}

/**
 * Structural view of the PostgREST filter builder. Only these allow-listed
 * operations are used; column names are hardcoded switches, never request data.
 */
type TaskQueryBuilder = {
  eq(column: string, value: unknown): TaskQueryBuilder;
  neq(column: string, value: unknown): TaskQueryBuilder;
  in(column: string, values: readonly unknown[]): TaskQueryBuilder;
  not(column: string, operator: string, value: unknown): TaskQueryBuilder;
  gte(column: string, value: unknown): TaskQueryBuilder;
  lte(column: string, value: unknown): TaskQueryBuilder;
  lt(column: string, value: unknown): TaskQueryBuilder;
  is(column: string, value: null): TaskQueryBuilder;
  ilike(column: string, pattern: string): TaskQueryBuilder;
  order(column: string, options?: { ascending?: boolean }): TaskQueryBuilder;
  range(from: number, to: number): TaskQueryBuilder;
};

function shiftDateOnly(value: string, days: number) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function applyListFilter(
  builder: TaskQueryBuilder,
  filter: TaskViewFilter,
  today: string | null,
): TaskQueryBuilder {
  if (filter.field === "status" || filter.field === "priority" || filter.field === "project") {
    const column =
      filter.field === "status" ? "status" : filter.field === "priority" ? "priority" : "project_id";
    if (filter.operator === "is") {
      return filter.field === "priority"
        ? builder.in(column, filter.values)
        : builder.eq(column, filter.values[0]);
    }
    if (filter.operator === "is_any_of") return builder.in(column, filter.values);
    if (filter.operator === "is_not") return builder.neq(column, filter.values[0]);
    return builder.not(column, "in", `(${filter.values.join(",")})`);
  }

  if (filter.field === "goal") {
    // A null goal matches `is_not`/`is_none_of` in the application engine, but
    // SQL `<>` would drop those rows. Only push down the exact positive forms;
    // the application applies the rest.
    if (filter.operator === "is") return builder.eq("goal_id", filter.values[0]);
    if (filter.operator === "is_any_of") return builder.in("goal_id", filter.values);
    return builder;
  }

  if (filter.field === "estimate") {
    const [rawMin, rawMax] = filter.values;
    let next = builder;
    if (rawMin !== "") next = next.gte("estimate_minutes", Number(rawMin));
    if (rawMax !== "") next = next.lte("estimate_minutes", Number(rawMax));
    return next;
  }

  if (filter.field === "due_within_days") {
    if (!today) return builder;
    return builder
      .gte("due_date", today)
      .lte("due_date", shiftDateOnly(today, Number(filter.values[0])));
  }

  if (filter.field === "due_bucket") {
    const bucket = filter.values[0];
    if (filter.operator === "is" && bucket === "none") {
      return builder.is("due_date", null);
    }
    if (filter.operator !== "is" || !today) return builder;
    if (bucket === "overdue") {
      return builder.lt("due_date", today).neq("status", "done");
    }
    if (bucket === "today") {
      return builder.eq("due_date", today).neq("status", "done");
    }
    if (bucket === "next_7_days") {
      return builder
        .gte("due_date", today)
        .lte("due_date", shiftDateOnly(today, 7))
        .neq("status", "done");
    }
    // `later` is a complement (includes completed work); the application
    // engine applies it after the bounded page load.
    return builder;
  }

  return builder;
}

function resolveTaskView(query: TaskQuery): TaskViewDefinition {
  return (
    query.view ??
    taskViewFromLegacyInput({
      status: query.status,
      priority: query.priority,
      projectId: query.projectId,
      goalId: query.goalId,
      due: query.due,
      sort: query.sort,
    })
  );
}

function applyTaskQuery(
  builder: TaskQueryBuilder,
  query: TaskQuery,
): TaskQueryBuilder {
  let next = builder;
  if (!query.includeArchived) next = next.is("archived_at", null);
  if (query.projectId) next = next.eq("project_id", query.projectId);
  if (query.goalId) next = next.eq("goal_id", query.goalId);
  if (query.plannedForDate) next = next.eq("planned_for_date", query.plannedForDate);

  const view = resolveTaskView(query);
  const today = query.today?.trim() || null;
  for (const filter of view.filters) {
    next = applyListFilter(next, filter, today);
  }
  if (view.activeOnly) next = next.neq("status", "done");
  if (view.search) next = next.ilike("title", `%${escapeLikePattern(view.search)}%`);

  return next;
}

export class SupabaseTasksRepository implements TasksRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async getScope(actor: AuthenticatedActor): Promise<RepositoryResult<TaskScopeRecord>> {
    const projects = await this.supabase
      .from("projects")
      .select("id")
      .eq("owner_user_id", actor.userId);
    if (projects.error) return failure(projects.error);

    const goals = await this.supabase
      .from("goals")
      .select("id,project_id")
      .eq("owner_user_id", actor.userId);
    if (goals.error) return failure(goals.error);

    return {
      ok: true,
      value: {
        projectIds: asRows(projects.data).map((row) => String(row.id)),
        goals: asRows(goals.data).map((row) => ({
          id: String(row.id),
          projectId: String(row.project_id),
        })),
      },
    };
  }

  async listTasks(actor: AuthenticatedActor, query: TaskQuery = {}): Promise<RepositoryResult<TaskRecord[]>> {
    const rows: Row[] = [];

    for (let from = 0; from < TASK_LIST_ROW_CAP; from += TASK_LIST_PAGE_SIZE) {
      const to = Math.min(from + TASK_LIST_PAGE_SIZE, TASK_LIST_ROW_CAP) - 1;
      let request = this.supabase
        .from("tasks")
        .select(TASK_SELECT)
        .eq("owner_user_id", actor.userId) as unknown as TaskQueryBuilder;

      request = applyTaskQuery(request, query);
      // Stable paging order; the application read model owns display ordering.
      request = request
        .order("id", { ascending: true })
        .range(from, to);

      const result = (await request) as unknown as { data: unknown[] | null; error: { code?: string; message: string } | null };
      if (result.error) return failure(result.error);

      const page = asRows(result.data);
      rows.push(...page);
      if (page.length < TASK_LIST_PAGE_SIZE) break;
    }

    return this.hydrateTasks(actor, rows);
  }

  async countTasks(actor: AuthenticatedActor, query: TaskQuery = {}): Promise<RepositoryResult<number>> {
    let request = this.supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("owner_user_id", actor.userId) as unknown as TaskQueryBuilder;

    request = applyTaskQuery(request, query);

    const result = (await request) as unknown as {
      count: number | null;
      error: { code?: string; message: string } | null;
    };
    if (result.error) return failure(result.error);
    return { ok: true, value: result.count ?? 0 };
  }

  async listProjectOptions(
    actor: AuthenticatedActor,
  ): Promise<RepositoryResult<TaskProjectOptionRecord[]>> {
    const result = await this.supabase
      .from("projects")
      .select("id, name, slug")
      .eq("owner_user_id", actor.userId)
      .order("name", { ascending: true });
    if (result.error) return failure(result.error);
    return {
      ok: true,
      value: asRows(result.data).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        slug: asNullableString(row.slug),
      })),
    };
  }

  async listGoalOptions(
    actor: AuthenticatedActor,
  ): Promise<RepositoryResult<TaskGoalOptionRecord[]>> {
    const result = await this.supabase
      .from("goals")
      .select("id, title, project_id")
      .eq("owner_user_id", actor.userId)
      .order("created_at", { ascending: false });
    if (result.error) return failure(result.error);
    return {
      ok: true,
      value: asRows(result.data).map((row) => ({
        id: String(row.id),
        title: String(row.title),
        projectId: String(row.project_id),
      })),
    };
  }

  async getTask(actor: AuthenticatedActor, taskId: string): Promise<RepositoryResult<TaskRecord | null>> {
    const result = await this.supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("id", taskId)
      .eq("owner_user_id", actor.userId)
      .maybeSingle();

    if (result.error) return failure(result.error);
    if (!result.data) return { ok: true, value: null };

    const hydrated = await this.hydrateTasks(actor, [asRow(result.data)]);
    if (!hydrated.ok) return hydrated;
    return { ok: true, value: hydrated.value[0] ?? null };
  }

  async createTask(actor: AuthenticatedActor, input: CreateTaskRecordInput): Promise<RepositoryResult<TaskRecord>> {
    const identity = mcpOperationIdentity(input);
    const result = await this.supabase
      .from("tasks")
      .insert({
        ...(input.id ? { id: input.id } : {}),
        owner_user_id: actor.userId,
        title: input.title,
        project_id: input.projectId,
        goal_id: input.goalId,
        description: input.description,
        blocked_reason: input.blockedReason,
        status: input.status,
        priority: input.priority,
        due_date: input.dueDate,
        estimate_minutes: input.estimateMinutes,
        planned_for_date: input.plannedForDate ?? null,
        scheduled_start_at: input.scheduledStartAt ?? null,
        scheduled_end_at: input.scheduledEndAt ?? null,
        calendar_sync_enabled: input.calendarSyncEnabled ?? false,
        calendar_reminder_minutes: input.calendarReminderMinutes ?? 10,
        ...(identity
          ? {
              mcp_operation_id: identity.mcpOperationId,
              mcp_client_id: identity.mcpClientId,
            }
          : {}),
      })
      .select(TASK_SELECT)
      .single();

    if (result.error) {
      if (identity && isSupabaseUniqueConstraintViolation(result.error, "tasks_mcp_operation_unique")) {
        const replay = await this.findTaskByOperation(actor, identity);
        if (replay.ok && replay.value) return { ok: true, value: replay.value };
        if (!replay.ok) return replay;
      }
      return failure(result.error);
    }
    if (!result.data) return failure(null);
    const createdRow = asRow(result.data);

    if (input.recurrence) {
      const recurrence = await this.supabase.from("task_recurrences").insert({
        owner_user_id: actor.userId,
        task_id: String(createdRow.id),
        rule: input.recurrence.rule,
        anchor_date: input.recurrence.anchorDate,
        timezone: input.recurrence.timezone,
        next_occurrence_date: input.recurrence.nextOccurrenceDate,
      });
      if (recurrence.error) return failure(recurrence.error);
    }

    const hydrated = await this.hydrateTasks(actor, [createdRow]);
    if (!hydrated.ok) return hydrated;
    return { ok: true, value: hydrated.value[0] };
  }

  async updateTask(actor: AuthenticatedActor, input: UpdateTaskRecordInput): Promise<RepositoryResult<TaskRecord>> {
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.title !== undefined) payload.title = input.title;
    if (input.description !== undefined) payload.description = input.description;
    if (input.blockedReason !== undefined) payload.blocked_reason = input.blockedReason;
    if (input.status !== undefined) payload.status = input.status;
    if (input.priority !== undefined) payload.priority = input.priority;
    if (input.dueDate !== undefined) payload.due_date = input.dueDate;
    if (input.estimateMinutes !== undefined) payload.estimate_minutes = input.estimateMinutes;
    if (input.projectId !== undefined) payload.project_id = input.projectId;
    if (input.goalId !== undefined) payload.goal_id = input.goalId;
    if (input.plannedForDate !== undefined) payload.planned_for_date = input.plannedForDate;
    if (input.focusRank !== undefined) payload.focus_rank = input.focusRank;
    if (input.scheduledStartAt !== undefined) payload.scheduled_start_at = input.scheduledStartAt;
    if (input.scheduledEndAt !== undefined) payload.scheduled_end_at = input.scheduledEndAt;
    if (input.calendarSyncEnabled !== undefined) payload.calendar_sync_enabled = input.calendarSyncEnabled;
    if (input.calendarReminderMinutes !== undefined) payload.calendar_reminder_minutes = input.calendarReminderMinutes;

    let taskUpdate = this.supabase
      .from("tasks")
      .update(payload)
      .eq("id", input.taskId)
      .eq("owner_user_id", actor.userId);
    if (input.expectedUpdatedAt !== undefined) {
      taskUpdate = taskUpdate.eq("updated_at", input.expectedUpdatedAt);
    }
    const result = input.expectedUpdatedAt === undefined
      ? await taskUpdate.select(TASK_SELECT).single()
      : await taskUpdate.select(TASK_SELECT).maybeSingle();
    if (result.error) return failure(result.error);
    if (!result.data) {
      // A conditional update matching no row means another writer changed the
      // version after the caller read it. Keep that race distinguishable from
      // an ordinary update failure so the application can avoid overwriting it.
      return input.expectedUpdatedAt !== undefined
        ? { ok: false, error: { code: "conflict" } }
        : failure(null);
    }

    const hydrated = await this.hydrateTasks(actor, [asRow(result.data)]);
    if (!hydrated.ok) return hydrated;
    return { ok: true, value: hydrated.value[0] };
  }

  async setTaskArchived(
    actor: AuthenticatedActor,
    input: Readonly<{ taskId: string; archivedAt: string | null }>,
  ): Promise<RepositoryResult<TaskRecord>> {
    const result = await this.supabase
      .from("tasks")
      .update({
        archived_at: input.archivedAt,
        archived_by: input.archivedAt ? actor.userId : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.taskId)
      .eq("owner_user_id", actor.userId)
      .select(TASK_SELECT)
      .single();
    if (result.error || !result.data) return failure(result.error);

    const hydrated = await this.hydrateTasks(actor, [asRow(result.data)]);
    if (!hydrated.ok) return hydrated;
    return { ok: true, value: hydrated.value[0] };
  }

  async createReminder(
    actor: AuthenticatedActor,
    input: Readonly<{
      taskId: string;
      remindAt: string;
      channel: "email";
      status: "pending";
      mcpOperationId?: string;
      mcpClientId?: string;
      deliveryMode?: "push" | "email" | "both";
      source?: string | null;
      sourceId?: string | null;
    }>,
  ): Promise<RepositoryResult<TaskRecord>> {
    const identity = mcpOperationIdentity(input);
    const result = await this.supabase.from("task_reminders").insert({
      owner_user_id: actor.userId,
      task_id: input.taskId,
      remind_at: input.remindAt,
      channel: input.channel,
      delivery_mode: input.deliveryMode ?? "email",
      status: input.status,
      ...(input.source ? { source: input.source } : {}),
      ...(input.sourceId ? { source_id: input.sourceId } : {}),
      ...(identity
        ? {
            mcp_operation_id: identity.mcpOperationId,
            mcp_client_id: identity.mcpClientId,
        }
        : {}),
    });
    if (result.error) {
      if (identity && isSupabaseUniqueConstraintViolation(result.error, "task_reminders_mcp_operation_unique")) {
        const replay = await this.findReminderByOperation(actor, identity);
        if (replay.ok && replay.value) return { ok: true, value: replay.value };
        if (!replay.ok) return replay;
      }
      if (
        input.source &&
        input.sourceId &&
        isSupabaseUniqueConstraintViolation(result.error, "task_reminders_owner_source_source_id_unique")
      ) {
        // Smart Inbox/source idempotency is a separate invariant from MCP
        // operation fencing. Only its named unique index can replay here.
        const task = await this.getTask(actor, input.taskId);
        return task.ok && task.value ? { ok: true, value: task.value } : task.ok ? failure(null) : task;
      }
      return failure(result.error);
    }

    const task = await this.getTask(actor, input.taskId);
    return task.ok && task.value ? { ok: true, value: task.value } : task.ok ? failure(null) : task;
  }

  async findReminderByOperation(
    actor: AuthenticatedActor,
    identity: { mcpOperationId: string; mcpClientId: string },
  ): Promise<RepositoryResult<TaskRecord | null>> {
    const result = await this.supabase
      .from("task_reminders")
      .select("task_id")
      .eq("owner_user_id", actor.userId)
      .eq("mcp_client_id", identity.mcpClientId)
      .eq("mcp_operation_id", identity.mcpOperationId)
      .maybeSingle();
    if (result.error) return failure(result.error);
    if (!result.data) return { ok: true, value: null };

    const task = await this.getTask(actor, String((result.data as Row).task_id));
    return task.ok && task.value ? { ok: true, value: task.value } : task.ok ? failure(null) : task;
  }

  async cancelReminder(
    actor: AuthenticatedActor,
    input: Readonly<{ taskId: string; reminderId: string; status: "cancelled" }>,
  ): Promise<RepositoryResult<TaskRecord>> {
    const result = await this.supabase
      .from("task_reminders")
      .update({ status: input.status, updated_at: new Date().toISOString() })
      .eq("id", input.reminderId)
      .eq("task_id", input.taskId)
      .eq("owner_user_id", actor.userId);
    if (result.error) return failure(result.error);

    const task = await this.getTask(actor, input.taskId);
    return task.ok && task.value ? { ok: true, value: task.value } : task.ok ? failure(null) : task;
  }

  async setRecurrence(
    actor: AuthenticatedActor,
    input: Readonly<{ taskId: string; schedule: TaskRecurrenceSchedule | null }>,
  ): Promise<RepositoryResult<TaskRecord>> {
    if (input.schedule) {
      const result = await this.supabase
        .from("task_recurrences")
        .upsert(
          {
            owner_user_id: actor.userId,
            task_id: input.taskId,
            rule: input.schedule.rule,
            anchor_date: input.schedule.anchorDate,
            timezone: input.schedule.timezone,
            next_occurrence_date: input.schedule.nextOccurrenceDate,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "task_id" },
        );
      if (result.error) return failure(result.error);
    } else {
      const result = await this.supabase
        .from("task_recurrences")
        .delete()
        .eq("task_id", input.taskId)
        .eq("owner_user_id", actor.userId);
      if (result.error) return failure(result.error);
    }

    const task = await this.getTask(actor, input.taskId);
    return task.ok && task.value ? { ok: true, value: task.value } : task.ok ? failure(null) : task;
  }

  private async findTaskByOperation(
    actor: AuthenticatedActor,
    identity: { mcpOperationId: string; mcpClientId: string },
  ): Promise<RepositoryResult<TaskRecord | null>> {
    const result = await this.supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("owner_user_id", actor.userId)
      .eq("mcp_client_id", identity.mcpClientId)
      .eq("mcp_operation_id", identity.mcpOperationId)
      .maybeSingle();

    if (result.error) return failure(result.error);
    if (!result.data) return { ok: true, value: null };

    const hydrated = await this.hydrateTasks(actor, [asRow(result.data)]);
    if (!hydrated.ok) return hydrated;
    return { ok: true, value: hydrated.value[0] ?? null };
  }

  async setPlannedDate(
    actor: AuthenticatedActor,
    input: Readonly<{ taskId: string; plannedForDate: string | null; expectedUpdatedAt?: string }>,
  ): Promise<RepositoryResult<TaskRecord>> {
    return this.updateTask(actor, {
      taskId: input.taskId,
      plannedForDate: input.plannedForDate,
      expectedUpdatedAt: input.expectedUpdatedAt,
    });
  }

  async setStatus(
    actor: AuthenticatedActor,
    input: Readonly<{ taskId: string; status: TaskStatus; blockedReason: string | null }>,
  ): Promise<RepositoryResult<TaskRecord>> {
    return this.updateTask(actor, {
      taskId: input.taskId,
      status: input.status,
      blockedReason: input.blockedReason,
    });
  }

  async clearCompletedPlannedDate(
    actor: AuthenticatedActor,
    input: Readonly<{ plannedForDate: string }>,
  ): Promise<RepositoryResult<number>> {
    const result = await this.supabase
      .from("tasks")
      .update(
        { planned_for_date: null, updated_at: new Date().toISOString() },
        { count: "exact" },
      )
      .eq("owner_user_id", actor.userId)
      .eq("planned_for_date", input.plannedForDate)
      .in("status", ["done", "complete", "completed"]);

    if (result.error) return failure(result.error);
    return { ok: true, value: result.count ?? 0 };
  }

  async getFocusRank(
    actor: AuthenticatedActor,
    taskId: string,
  ): Promise<RepositoryResult<{ exists: boolean; focusRank: number | null }>> {
    const result = await this.supabase
      .from("tasks")
      .select("id, focus_rank")
      .eq("id", taskId)
      .eq("owner_user_id", actor.userId)
      .maybeSingle();
    if (result.error) return failure(result.error);
    if (!result.data) return { ok: true, value: { exists: false, focusRank: null } };
    return { ok: true, value: { exists: true, focusRank: asNullableNumber(asRow(result.data).focus_rank) } };
  }

  async getMaxFocusRank(
    actor: AuthenticatedActor,
    input: Readonly<{ includeArchived: boolean }>,
  ): Promise<RepositoryResult<number | null>> {
    let request = this.supabase
      .from("tasks")
      .select("focus_rank")
      .eq("owner_user_id", actor.userId)
      .not("focus_rank", "is", null)
      .order("focus_rank", { ascending: false })
      .limit(1);
    if (!input.includeArchived) request = request.is("archived_at", null);

    const result = await request;
    if (result.error) return failure(result.error);
    const row = asRows(result.data)[0];
    return { ok: true, value: row ? asNullableNumber(row.focus_rank) : null };
  }

  async setFocusRank(
    actor: AuthenticatedActor,
    input: Readonly<{ taskId: string; focusRank: number | null }>,
  ): Promise<RepositoryResult<void>> {
    const result = await this.supabase
      .from("tasks")
      .update({ focus_rank: input.focusRank, updated_at: new Date().toISOString() })
      .eq("id", input.taskId)
      .eq("owner_user_id", actor.userId);
    if (result.error) return failure(result.error);
    return { ok: true, value: undefined };
  }

  private async hydrateTasks(actor: AuthenticatedActor, rows: Row[]): Promise<RepositoryResult<TaskRecord[]>> {
    if (rows.length === 0) return { ok: true, value: [] };
    const taskIds = rows.map((row) => String(row.id));
    const chunkSize = 200;
    const chunks: string[][] = [];
    for (let index = 0; index < taskIds.length; index += chunkSize) {
      chunks.push(taskIds.slice(index, index + chunkSize));
    }

    const [reminderPages, recurrencePages, sessionPages] = await Promise.all([
      Promise.all(
        chunks.map((chunk) =>
          this.supabase
            .from("task_reminders")
            .select(REMINDER_SELECT)
            .eq("owner_user_id", actor.userId)
            .in("task_id", chunk)
            .order("remind_at", { ascending: true }),
        ),
      ),
      Promise.all(
        chunks.map((chunk) =>
          this.supabase
            .from("task_recurrences")
            .select(RECURRENCE_SELECT)
            .eq("owner_user_id", actor.userId)
            .in("task_id", chunk),
        ),
      ),
      Promise.all(
        chunks.map((chunk) =>
          this.supabase
            .from("task_sessions")
            .select(SESSION_TOTAL_SELECT)
            .eq("owner_user_id", actor.userId)
            .in("task_id", chunk),
        ),
      ),
    ]);

    for (const page of reminderPages) {
      if (page.error) return failure(page.error);
    }
    for (const page of recurrencePages) {
      if (page.error) return failure(page.error);
    }

    const durationByTaskId = new Map<string, number>();
    for (const page of sessionPages) {
      for (const rawRow of asRows(page.data)) {
        const row = rawRow as Record<string, unknown>;
        const taskId = String(row.task_id);
        const seconds = typeof row.duration_seconds === "number" ? row.duration_seconds : Number(row.duration_seconds ?? 0);
        durationByTaskId.set(taskId, (durationByTaskId.get(taskId) ?? 0) + (Number.isFinite(seconds) ? seconds : 0));
      }
    }

    const reminderMap = new Map<string, TaskReminderRecord[]>();
    for (const page of reminderPages) {
      for (const row of asRows(page.data)) {
        const taskId = String(row.task_id);
        reminderMap.set(taskId, [...(reminderMap.get(taskId) ?? []), mapReminder(row)]);
      }
    }

    const recurrenceMap = new Map<string, TaskRecurrenceRecord>();
    for (const page of recurrencePages) {
      for (const row of asRows(page.data)) {
        recurrenceMap.set(String(row.task_id), mapRecurrence(row));
      }
    }

    return {
      ok: true,
      value: rows.map((row) => {
        const id = String(row.id);
        return mapTask(
          row,
          reminderMap.get(id) ?? [],
          recurrenceMap.get(id) ?? null,
          durationByTaskId.get(id) ?? 0,
        );
      }),
    };
  }
}

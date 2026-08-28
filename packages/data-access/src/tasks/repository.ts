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
import type { TaskRecurrenceRule } from "@ega/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeSupabaseError } from "../supabase/errors";

/** Hard ceiling on task rows fetched per list request; keeps payloads bounded. */
const TASK_LIST_ROW_CAP = 500;

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
    let request = this.supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("owner_user_id", actor.userId);

    if (!query.includeArchived) request = request.is("archived_at", null);
    if (query.status) request = request.eq("status", query.status);
    // Priority filtering happens in the database; due-filtering and ordering
    // happen in the application read model so counters can cover the full
    // filtered scope before the limit slice.
    if (query.priority) request = request.in("priority", [query.priority]);
    if (query.projectId) request = request.eq("project_id", query.projectId);
    if (query.goalId) request = request.eq("goal_id", query.goalId);
    if (query.plannedForDate) request = request.eq("planned_for_date", query.plannedForDate);

    request = request.order("updated_at", { ascending: false });
    request = request.limit(TASK_LIST_ROW_CAP);

    const result = await request;
    if (result.error) return failure(result.error);
    return this.hydrateTasks(actor, asRows(result.data));
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
      })
      .select(TASK_SELECT)
      .single();

    if (result.error || !result.data) return failure(result.error);
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

    const result = await this.supabase
      .from("tasks")
      .update(payload)
      .eq("id", input.taskId)
      .eq("owner_user_id", actor.userId)
      .select(TASK_SELECT)
      .single();
    if (result.error || !result.data) return failure(result.error);

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
      deliveryMode?: "push" | "email" | "both";
      source?: string | null;
      sourceId?: string | null;
    }>,
  ): Promise<RepositoryResult<TaskRecord>> {
    const result = await this.supabase.from("task_reminders").insert({
      owner_user_id: actor.userId,
      task_id: input.taskId,
      remind_at: input.remindAt,
      channel: input.channel,
      delivery_mode: input.deliveryMode ?? "email",
      status: input.status,
      ...(input.source ? { source: input.source } : {}),
      ...(input.sourceId ? { source_id: input.sourceId } : {}),
    });
    if (result.error) {
      const code = String((result.error as unknown as { code?: string })?.code ?? "");
      const msg = String((result.error as unknown as { message?: string })?.message ?? "");
      const isDuplicate = code.includes("23505") || /duplicate|unique/i.test(msg);
      // If duplicate due to source idempotency, treat as success: fetch existing task with reminders
      if (isDuplicate && input.source && input.sourceId) {
        const task = await this.getTask(actor, input.taskId);
        return task.ok && task.value ? { ok: true, value: task.value } : task.ok ? failure(null) : task;
      }
      return failure(result.error);
    }

    const task = await this.getTask(actor, input.taskId);
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

  async setPlannedDate(
    actor: AuthenticatedActor,
    input: Readonly<{ taskId: string; plannedForDate: string | null }>,
  ): Promise<RepositoryResult<TaskRecord>> {
    return this.updateTask(actor, {
      taskId: input.taskId,
      plannedForDate: input.plannedForDate,
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

    const [reminders, recurrences, sessionTotals] = await Promise.all([
      this.supabase
        .from("task_reminders")
        .select(REMINDER_SELECT)
        .eq("owner_user_id", actor.userId)
        .in("task_id", taskIds)
        .order("remind_at", { ascending: true }),
      this.supabase
        .from("task_recurrences")
        .select(RECURRENCE_SELECT)
        .eq("owner_user_id", actor.userId)
        .in("task_id", taskIds),
      this.supabase
        .from("task_sessions")
        .select(SESSION_TOTAL_SELECT)
        .eq("owner_user_id", actor.userId)
        .in("task_id", taskIds),
    ]);

    if (reminders.error) return failure(reminders.error);
    if (recurrences.error) return failure(recurrences.error);

    const durationByTaskId = new Map<string, number>();
    for (const rawRow of asRows(sessionTotals.data)) {
      const row = rawRow as Record<string, unknown>;
      const taskId = String(row.task_id);
      const seconds = typeof row.duration_seconds === "number" ? row.duration_seconds : Number(row.duration_seconds ?? 0);
      durationByTaskId.set(taskId, (durationByTaskId.get(taskId) ?? 0) + (Number.isFinite(seconds) ? seconds : 0));
    }

    const reminderMap = new Map<string, TaskReminderRecord[]>();
    for (const row of asRows(reminders.data)) {
      const taskId = String(row.task_id);
      reminderMap.set(taskId, [...(reminderMap.get(taskId) ?? []), mapReminder(row)]);
    }

    const recurrenceMap = new Map<string, TaskRecurrenceRecord>();
    for (const row of asRows(recurrences.data)) {
      recurrenceMap.set(String(row.task_id), mapRecurrence(row));
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

import { TASK_TITLE_MAX, TASK_TITLE_LENGTH_ERROR } from "@/lib/task-domain";
import { zonedWallTimeToUtcIso } from "@ega/domain/time-context";
import { createClient } from "@/lib/supabase/server";
import type { Json, TablesInsert, TablesUpdate } from "@/lib/supabase/database.types";
import {
  getTodayLocalIsoDate,
  isDateOnlyValue,
  normalizeTaskDueDateInput,
  normalizeTaskStartDateInput,
  normalizeTaskPlannedDateInput,
  shiftDateOnlyValue,
} from "@/lib/task-due-date";
import {
  buildCalendarRange,
  buildTaskCalendarProjection,
  getLocalWallTimeParts,
  type CalendarProjectableSession,
  type CalendarProjectableTask,
  type TaskCalendarProjection,
} from "@/lib/task-calendar";
import type {
  TaskCalendarDateField,
  TaskCalendarView,
} from "@/lib/task-list";
import { normalizeTaskEstimateInput } from "@/lib/task-estimate";
import { normalizeTaskScheduleInput } from "@/lib/task-schedule";
import {
  getFirstTaskRecurrenceDateAfter,
  getNextTaskRecurrenceDateFromAnchor,
  isTaskRecurrenceRule,
  normalizeTaskRecurrenceScheduleInput,
  type TaskRecurrenceRule,
} from "@/lib/task-recurrence";
import {
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  isTaskCompletedStatus,
  isTaskPriority,
  isTaskStatus,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/task-domain";
import type { ManualWorkedTimePayload } from "@/lib/manual-worked-time";
import {
  DEFAULT_CALENDAR_REMINDER_MINUTES,
  normalizeCalendarReminderMinutes,
} from "@/lib/services/calendar-settings-service";
import { enqueueCalendarSyncJob } from "@/lib/services/calendar-sync-service";
import type { GoogleCalendarClient } from "@/lib/services/google-calendar-service";
import {
  taskViewFromLegacyInput,
  type TaskDueFilter,
  type TaskSortValue,
  type TaskViewDefinition,
} from "@/lib/task-list";
import {
  applyTaskView,
  type TaskViewRecord,
} from "@ega/application/tasks/view";
import {
  canExactlyCountTaskViewFilters,
  normalizeTaskViewDefinition,
} from "@ega/contracts/common/task-list";
import type { TaskViewFilter as TaskArchiveViewFilter } from "@/lib/task-archive";
import { getTaskTotalDurationMap } from "@/lib/task-session";
import { stopActiveTimerSessionsForTask } from "@/lib/services/timer-service";
import {
  getActiveTasksForOwner,
  getTaskCountForOwner,
  TASK_READ_PAGE_SIZE,
  type TaskReadQuery,
} from "@/lib/services/task-read-service";
import {
  getTaskDependencyDetail,
  type TaskDependencyDetail,
} from "@/lib/services/task-dependency-service";
import {
  isMissingTasksArchivedAtColumn,
  isMissingSupabaseColumn,
  isMissingSupabaseTable,
  isMissingTasksBlockedReasonColumn,
  isMissingTasksCompletedAtColumn,
} from "@/lib/supabase-error";
import {
  BLOCKED_SAVED_VIEW_DEFINITION,
  BLOCKED_SAVED_VIEW_ID,
  DEEP_WORK_SAVED_VIEW_DEFINITION,
  DEEP_WORK_SAVED_VIEW_ID,
  DUE_THIS_WEEK_SAVED_VIEW_DEFINITION,
  DUE_THIS_WEEK_SAVED_VIEW_ID,
  QUICK_WINS_SAVED_VIEW_DEFINITION,
  QUICK_WINS_SAVED_VIEW_ID,
  getTaskSavedViewDefinitionFromFilters,
  getTaskSavedViewFiltersFromDefinition,
  getTaskViewFromSavedView,
  normalizeTaskSavedViewFilters,
} from "@/lib/task-saved-views";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type CreateTasksOptions = {
  supabase?: SupabaseServerClient;
  /** @deprecated Calendar sync is queued through calendar_sync_jobs. */
  calendarClient?: Pick<GoogleCalendarClient, "createEvent">;
  /**
   * Canonical account IANA timezone used as the default recurrence timezone
   * when the caller does not supply an explicit one.
   */
  recurrenceDefaultTimezone?: string;
  /**
   * Canonical account local date (YYYY-MM-DD) from the owner's Time Context.
   * Used as the recurrence anchor fallback instead of the runtime-local date
   * so web writes agree with the Hono transport near account midnight.
   */
  fallbackAnchorDate?: string;
};

type TaskSavedViewSelectRow = {
  id: string;
  name: string;
  status: string | null;
  project_id: string | null;
  goal_id: string | null;
  due_filter: string | null;
  sort_value: string | null;
  definition_json?: Json | null;
  updated_at: string;
};

export const TASK_REMINDER_CHANNEL_VALUES = ["email"] as const;
export const TASK_REMINDER_STATUS_VALUES = [
  "pending",
  "processing",
  "sent",
  "failed",
  "cancelled",
] as const;

export type TaskReminderChannel = (typeof TASK_REMINDER_CHANNEL_VALUES)[number];
export type TaskReminderStatus = (typeof TASK_REMINDER_STATUS_VALUES)[number];

export type TaskReminderRecord = {
  id: string;
  task_id: string;
  remind_at: string;
  channel: TaskReminderChannel;
  status: TaskReminderStatus;
  sent_at: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskRecurrenceRecord = {
  id: string;
  task_id: string;
  rule: TaskRecurrenceRule;
  anchor_date: string;
  timezone: string;
  next_occurrence_date: string;
  last_generated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskScopeSnapshot = {
  projectIds: Set<string>;
  goalsById: Map<string, { id: string; project_id: string }>;
};

export type TasksWorkspaceFilters = {
  activeStatus: TaskStatus | null;
  requestedProjectId: string | null;
  requestedGoalId: string | null;
  activeDueFilter: TaskDueFilter;
  activeSort: TaskSortValue;
  activeView: TaskArchiveViewFilter;
  activeTasksOnly?: boolean;
  activePriorityValues?: ReadonlyArray<TaskPriority>;
  activeEstimateMinMinutes?: number | null;
  activeEstimateMaxMinutes?: number | null;
  activeDueWithinDays?: number | null;
  /** Canonical toolbar definition; supersedes the legacy fields above. */
  view?: TaskViewDefinition;
};

export type TasksWorkspaceData = {
  projects: Array<{ id: string; name: string; slug?: string | null }>;
  goals: Array<{ id: string; title: string; project_id: string }>;
  tasks: Array<{
    id: string;
    title: string;
    description: string | null;
    blocked_reason: string | null;
    status: string;
    priority: string;
    start_date: string | null;
    due_date: string | null;
    planned_for_date: string | null;
    scheduled_start_at: string | null;
    scheduled_end_at: string | null;
    calendar_sync_enabled: boolean;
    calendar_reminder_minutes: number;
    estimate_minutes: number | null;
    updated_at: string;
    completed_at: string | null;
    project_id: string;
    goal_id: string | null;
    focus_rank: number | null;
    board_rank: string | null;
    created_at?: string | null;
    archived_at: string | null;
    archived_by: string | null;
    projects: { name: string; slug?: string | null } | null;
    goals: { title: string } | null;
    task_reminders: TaskReminderRecord[];
    task_recurrences: TaskRecurrenceRecord[];
  }>;
  summary: {
    total: number;
    active: number;
    archived: number;
  };
  taskTotalDurations: Record<string, number>;
  savedViews: Array<{
    id: string;
    name: string;
    status: string | null;
    project_id: string | null;
    goal_id: string | null;
    due_filter: string;
    sort_value: string;
    definition_json: Json | null;
    updated_at: string;
    is_default?: boolean;
  }>;
  savedViewsUnavailable: boolean;
  activeProjectId: string | null;
  activeGoalId: string | null;
  /** Canonical view after owner-scope sanitization. */
  view: TaskViewDefinition;
  /** Exact owner-scoped matches before the row ceiling, when countable. */
  filteredTotal: number;
  /** Rows actually loaded into `tasks`. */
  loadedCount: number;
  truncated: boolean;
  /** Present only when the calendar layout requested a visible window. */
  calendar: TaskCalendarProjection | null;
};

export type TasksWorkspaceCalendarOptions = {
  view: TaskCalendarView;
  dateField: TaskCalendarDateField;
  anchorDate: string;
  timezone: string;
};

export type TaskRecord = TasksWorkspaceData["tasks"][number];

export type ValidateTaskInlineUpdateInput = {
  taskId: string;
  title?: unknown;
  projectId?: unknown;
  goalId?: unknown;
  description?: unknown;
  status: string;
  priority: string;
  startDate?: unknown;
  dueDate: unknown;
  plannedForDate?: unknown;
  estimateMinutes: unknown;
  blockedReason: unknown;
  recurrenceRule?: unknown;
  recurrenceAnchorDate?: unknown;
  recurrenceTimezone?: unknown;
  scheduledStartAt?: unknown;
  scheduledEndAt?: unknown;
  /**
   * Canonical account IANA timezone used to interpret scheduled wall times.
   * Supplied by the server action from the owner's persisted Time Context —
   * never a numeric browser offset.
   */
  accountTimezone?: string;
  /**
   * Canonical account local date (YYYY-MM-DD) from the owner's Time Context.
   * Used as the recurrence anchor fallback instead of the runtime-local date
   * so web writes agree with the Hono transport near account midnight.
   */
  fallbackAnchorDate?: string;
  calendarSyncEnabled?: unknown;
  calendarReminderMinutes?: unknown;
};

export type ValidatedTaskInlineUpdateInput = {
  taskId: string;
  title?: string;
  projectId?: string;
  goalId?: string | null;
  description?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  startDate?: string | null;
  dueDate: string | null;
  plannedForDate?: string | null;
  estimateMinutes: number | null;
  blockedReason: string | null;
  recurrenceRule?: TaskRecurrenceRule | null;
  recurrenceAnchorDate?: string | null;
  recurrenceTimezone?: string | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  calendarSyncEnabled?: boolean;
  calendarReminderMinutes?: number;
};

const SYSTEM_TASK_SAVED_VIEWS = [
  {
    id: DEEP_WORK_SAVED_VIEW_ID,
    name: "Deep Work",
    definition_json: DEEP_WORK_SAVED_VIEW_DEFINITION,
  },
  {
    id: QUICK_WINS_SAVED_VIEW_ID,
    name: "Quick Wins",
    definition_json: QUICK_WINS_SAVED_VIEW_DEFINITION,
  },
  {
    id: BLOCKED_SAVED_VIEW_ID,
    name: "Blocked",
    definition_json: BLOCKED_SAVED_VIEW_DEFINITION,
  },
  {
    id: DUE_THIS_WEEK_SAVED_VIEW_ID,
    name: "Due This Week",
    definition_json: DUE_THIS_WEEK_SAVED_VIEW_DEFINITION,
  },
] as const;

export function normalizeTaskBlockedReasonInput(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function isTaskReminderChannel(value: string): value is TaskReminderChannel {
  return TASK_REMINDER_CHANNEL_VALUES.includes(value as TaskReminderChannel);
}

export function isTaskReminderStatus(value: string): value is TaskReminderStatus {
  return TASK_REMINDER_STATUS_VALUES.includes(value as TaskReminderStatus);
}

function getTaskBlockedReasonValidationError(
  status: TaskStatus,
  blockedReason: string | null,
) {
  if (status === "blocked" && !blockedReason) {
    return "Blocked reason is required when status is Blocked.";
  }

  return null;
}

type CreateTaskScopeErrorResult = {
  errorMessage: string;
};

type CreateTaskScopeSuccessResult = {
  errorMessage: null;
  scope: TaskScopeSnapshot;
};

export async function resolveSupabaseClient(supabase?: SupabaseServerClient) {
  if (supabase) {
    return supabase;
  }

  return createClient();
}

export async function getAuthenticatedUserId(supabase: SupabaseServerClient) {
  if (!("auth" in supabase) || typeof supabase.auth?.getUser !== "function") {
    return null;
  }

  const { data, error } = await supabase.auth.getUser();

  if (error) {
    return null;
  }

  return data.user?.id ?? null;
}

async function enqueueCreatedTasksForCalendarSync(
  supabase: SupabaseServerClient,
  taskRows: TablesInsert<"tasks">[],
  createdTaskIds: string[],
) {
  const syncErrors: string[] = [];

  if (createdTaskIds.length === 0) {
    return syncErrors;
  }

  const candidateRows = taskRows
    .map((task, index) => ({ task, taskId: createdTaskIds[index] }))
    .filter(({ task, taskId }) => Boolean(taskId && task.calendar_sync_enabled));

  if (candidateRows.length === 0) {
    return syncErrors;
  }

  const ownerUserId = await getAuthenticatedUserId(supabase);
  if (!ownerUserId) {
    return syncErrors;
  }

  for (const { taskId } of candidateRows) {
    const enqueueResult = await enqueueCalendarSyncJob(
      {
        taskId,
        ownerUserId,
        operation: "upsert",
      },
      { supabase },
    );

    if (enqueueResult.errorMessage) {
      syncErrors.push(enqueueResult.errorMessage);
    }
  }

  return syncErrors;
}

function isTasksBlockedReasonMissing(
  error: { code?: string | null; message?: string | null; details?: string | null; hint?: string | null } | null,
) {
  return isMissingTasksBlockedReasonColumn(error);
}

function isTasksArchivedAtMissing(
  error: { code?: string | null; message?: string | null; details?: string | null; hint?: string | null } | null,
) {
  return isMissingTasksArchivedAtColumn(error);
}

function isTaskSavedViewDefinitionJsonMissing(
  error: { code?: string | null; message?: string | null; details?: string | null; hint?: string | null } | null,
) {
  return isMissingSupabaseColumn(error, "public.task_saved_views", "definition_json");
}

async function getVisibleTaskScope(
  supabase: SupabaseServerClient,
): Promise<CreateTaskScopeErrorResult | CreateTaskScopeSuccessResult> {
  const [projectsResult, goalsResult] = await Promise.all([
    supabase.from("projects").select("id"),
    supabase.from("goals").select("id, project_id"),
  ]);

  if (projectsResult.error || goalsResult.error) {
    return {
      errorMessage: "Unable to validate task scope right now.",
    };
  }

  return {
    errorMessage: null,
    scope: {
      projectIds: new Set((projectsResult.data ?? []).map((project) => project.id)),
      goalsById: new Map((goalsResult.data ?? []).map((goal) => [goal.id, goal])),
    },
  };
}

export function getTaskInsertScopeError(
  row: TablesInsert<"tasks">,
  scope: TaskScopeSnapshot,
) {
  if (!scope.projectIds.has(row.project_id)) {
    return "Selected project is unavailable.";
  }

  if (!row.goal_id) {
    return null;
  }

  const goal = scope.goalsById.get(row.goal_id);

  if (!goal) {
    return "Selected goal is unavailable.";
  }

  if (goal.project_id !== row.project_id) {
    return "Selected goal does not belong to the chosen project.";
  }

  return null;
}

export async function getTaskScopeSnapshot(options?: { supabase?: SupabaseServerClient }) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const scopeResult = await getVisibleTaskScope(supabase);

  if (scopeResult.errorMessage !== null) {
    return {
      errorMessage: scopeResult.errorMessage,
      data: null,
    };
  }

  return {
    errorMessage: null,
    data: scopeResult.scope,
  };
}

function parseTaskReminderDateTime(rawValue: string, timezone: unknown) {
  const localMatch = rawValue.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );

  if (!localMatch) {
    const parsed = new Date(rawValue);
    return Number.isNaN(parsed.getTime())
      ? { errorMessage: "Reminder time is required.", value: null }
      : { errorMessage: null, value: parsed };
  }

  const normalizedTimezone = String(timezone ?? "").trim();
  if (!normalizedTimezone) {
    return { errorMessage: "Reminder timezone is required.", value: null };
  }

  try {
    const [, yearValue, monthValue, dayValue, hourValue, minuteValue, secondValue = "00"] =
      localMatch;
    const isoValue = zonedWallTimeToUtcIso({
      timezone: normalizedTimezone,
      date: `${yearValue}-${monthValue}-${dayValue}`,
      time: `${hourValue}:${minuteValue}:${secondValue}`,
    });
    return { errorMessage: null, value: new Date(isoValue) };
  } catch {
    return { errorMessage: "Reminder time is invalid for the account timezone.", value: null };
  }
}

function normalizeTaskReminderCreateInput(input: {
  taskId: string;
  remindAt: unknown;
  channel?: unknown;
  status?: unknown;
  timezone?: unknown;
  now?: Date;
}) {
  const taskId = input.taskId.trim();
  const channel = String(input.channel ?? "email").trim() || "email";
  const status = String(input.status ?? "pending").trim() || "pending";
  const rawRemindAt = String(input.remindAt ?? "").trim();
  const reminderTimeResult = parseTaskReminderDateTime(rawRemindAt, input.timezone);
  const remindAtDate = reminderTimeResult.value;
  const now = input.now ?? new Date();

  if (!taskId) {
    return { errorMessage: "Task is required." };
  }

  if (!rawRemindAt || reminderTimeResult.errorMessage || !remindAtDate) {
    return {
      errorMessage: reminderTimeResult.errorMessage ?? "Reminder time is required.",
    };
  }

  if (!isTaskReminderChannel(channel)) {
    return { errorMessage: "Reminder channel is not supported." };
  }

  if (!isTaskReminderStatus(status) || status !== "pending") {
    return { errorMessage: "Reminder status is not supported." };
  }

  if (remindAtDate.getTime() <= now.getTime()) {
    return { errorMessage: "Reminder time must be in the future." };
  }

  return {
    errorMessage: null,
    data: {
      taskId,
      remindAtIso: remindAtDate.toISOString(),
      channel,
      status,
    },
  };
}

function normalizeTaskReminderCancelInput(input: {
  taskId: string;
  reminderId: string;
  status?: unknown;
}) {
  const taskId = input.taskId.trim();
  const reminderId = input.reminderId.trim();
  const status = String(input.status ?? "cancelled").trim() || "cancelled";

  if (!taskId || !reminderId) {
    return { errorMessage: "Reminder cancel request is invalid." };
  }

  if (!isTaskReminderStatus(status) || status !== "cancelled") {
    return { errorMessage: "Reminder status is not supported." };
  }

  return {
    errorMessage: null,
    data: {
      taskId,
      reminderId,
      status,
    },
  };
}

function normalizeTaskReminderRow(row: {
  id: string;
  task_id: string;
  remind_at: string;
  channel: string;
  status: string;
  sent_at: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}): TaskReminderRecord {
  return {
    ...row,
    channel: isTaskReminderChannel(row.channel) ? row.channel : "email",
    status: isTaskReminderStatus(row.status) ? row.status : "failed",
  };
}

function normalizeTaskRecurrenceRow(row: {
  id: string;
  task_id: string;
  rule: string;
  anchor_date: string;
  timezone: string;
  next_occurrence_date: string;
  last_generated_at: string | null;
  created_at: string;
  updated_at: string;
}): TaskRecurrenceRecord | null {
  if (!isTaskRecurrenceRule(row.rule)) {
    return null;
  }

  return {
    ...row,
    rule: row.rule,
  };
}

function isTaskRecurrencesUnavailable(error: unknown) {
  return isMissingSupabaseTable(
    error as Parameters<typeof isMissingSupabaseTable>[0],
    "public.task_recurrences",
  );
}

/** Keep `.in()` URLs bounded when a filtered view loads thousands of rows. */
const TASK_ID_QUERY_CHUNK = 200;

function chunkTaskIds(taskIds: string[]) {
  const chunks: string[][] = [];
  for (let index = 0; index < taskIds.length; index += TASK_ID_QUERY_CHUNK) {
    chunks.push(taskIds.slice(index, index + TASK_ID_QUERY_CHUNK));
  }
  return chunks;
}

export async function getTaskRemindersForTasks(
  supabase: SupabaseServerClient,
  taskIds: string[],
) {
  const uniqueTaskIds = [...new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean))];
  const remindersByTaskId: Record<string, TaskReminderRecord[]> = {};

  if (uniqueTaskIds.length === 0) {
    return remindersByTaskId;
  }

  for (const chunk of chunkTaskIds(uniqueTaskIds)) {
    const { data, error } = await supabase
      .from("task_reminders")
      .select(
        "id, task_id, remind_at, channel, status, sent_at, failure_reason, created_at, updated_at",
      )
      .in("task_id", chunk)
      .order("remind_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to load task reminders: ${error.message}`);
    }

    for (const reminder of data ?? []) {
      const normalizedReminder = normalizeTaskReminderRow(reminder);
      remindersByTaskId[normalizedReminder.task_id] ??= [];
      remindersByTaskId[normalizedReminder.task_id]?.push(normalizedReminder);
    }
  }

  return remindersByTaskId;
}

export async function getTaskRecurrencesForTasks(
  supabase: SupabaseServerClient,
  taskIds: string[],
) {
  const uniqueTaskIds = [...new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean))];
  const recurrencesByTaskId: Record<string, TaskRecurrenceRecord[]> = {};

  if (uniqueTaskIds.length === 0) {
    return recurrencesByTaskId;
  }

  for (const chunk of chunkTaskIds(uniqueTaskIds)) {
    const { data, error } = await supabase
      .from("task_recurrences")
      .select(
        "id, task_id, rule, anchor_date, timezone, next_occurrence_date, last_generated_at, created_at, updated_at",
      )
      .in("task_id", chunk);

    if (error) {
      if (isTaskRecurrencesUnavailable(error)) {
        console.warn("task_recurrences unavailable during task recurrence load", {
          taskCount: uniqueTaskIds.length,
          code: error.code,
          message: error.message,
        });
        return recurrencesByTaskId;
      }

      throw new Error(`Failed to load task recurrences: ${error.message}`);
    }

    for (const recurrence of data ?? []) {
      const normalizedRecurrence = normalizeTaskRecurrenceRow(recurrence);
      if (!normalizedRecurrence) {
        continue;
      }
      recurrencesByTaskId[normalizedRecurrence.task_id] ??= [];
      recurrencesByTaskId[normalizedRecurrence.task_id]?.push(normalizedRecurrence);
    }
  }

  return recurrencesByTaskId;
}

export async function setTaskRecurrence(
  input: {
    taskId: string;
    recurrenceRule: unknown;
    recurrenceAnchorDate?: unknown;
    recurrenceTimezone?: unknown;
  },
  options?: {
    supabase?: SupabaseServerClient;
    updatedAtIso?: string;
    fallbackAnchorDate?: string;
    defaultTimezone?: string;
  }
) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const taskId = input.taskId.trim();
  const updatedAtIso = options?.updatedAtIso ?? new Date().toISOString();
  const scheduleResult = normalizeTaskRecurrenceScheduleInput({
    rule: input.recurrenceRule,
    anchorDate: input.recurrenceAnchorDate,
    timezone: input.recurrenceTimezone,
    defaultTimezone: options?.defaultTimezone,
    fallbackAnchorDate: options?.fallbackAnchorDate ?? getTodayLocalIsoDate(),
  });

  if (!taskId) {
    return { errorMessage: "Task is required." };
  }

  if (scheduleResult.errorMessage) {
    return { errorMessage: scheduleResult.errorMessage };
  }

  const taskResult = await getVisibleTaskById(supabase, taskId);
  if (taskResult.errorMessage) {
    return { errorMessage: taskResult.errorMessage };
  }

  if (!scheduleResult.schedule) {
    const { error } = await supabase.from("task_recurrences").delete().eq("task_id", taskId);
    return {
      errorMessage: error ? "Unable to clear recurring preset right now." : null,
    };
  }

  const { data: existing, error: existingError } = await supabase
    .from("task_recurrences")
    .select("id")
    .eq("task_id", taskId)
    .maybeSingle();

  if (existingError) {
    return { errorMessage: "Unable to load recurring preset right now." };
  }

  if (existing) {
    const { error } = await supabase
      .from("task_recurrences")
      .update({
        rule: scheduleResult.schedule.rule,
        anchor_date: scheduleResult.schedule.anchorDate,
        timezone: scheduleResult.schedule.timezone,
        next_occurrence_date: scheduleResult.schedule.nextOccurrenceDate,
        last_generated_at: null,
        updated_at: updatedAtIso,
      })
      .eq("task_id", taskId);

    return {
      errorMessage: error ? "Unable to update recurring preset right now." : null,
    };
  }

  const { error } = await supabase.from("task_recurrences").insert({
    task_id: taskId,
    rule: scheduleResult.schedule.rule,
    anchor_date: scheduleResult.schedule.anchorDate,
    timezone: scheduleResult.schedule.timezone,
    next_occurrence_date: scheduleResult.schedule.nextOccurrenceDate,
    last_generated_at: null,
  });

  return {
    errorMessage: error ? "Unable to save recurring preset right now." : null,
  };
}

async function getVisibleTaskById(supabase: SupabaseServerClient, taskId: string) {
  const userId = await getAuthenticatedUserId(supabase);
  let query = supabase
    .from("tasks")
    .select(userId ? "id, owner_user_id" : "id")
    .eq("id", taskId);

  if (userId) {
    query = query.eq("owner_user_id", userId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    return {
      errorMessage: "Unable to load task right now.",
      data: null,
    };
  }

  if (!data) {
    return {
      errorMessage: "Task was not found or is no longer available.",
      data: null,
    };
  }

  return {
    errorMessage: null,
    data,
  };
}

/**
 * Counts for the task list summary.
 *
 * Only counts are needed, so this issues two count-only (HEAD) queries instead
 * of transferring every task row just to read `archived_at`. `total` and
 * `active` come from the same owner-scoped (RLS) set the previous full-row read
 * used, so the summary values are unchanged; `archived` is derived as
 * total - active.
 */
export async function getTasksSummary(supabase: SupabaseServerClient): Promise<{
  total: number;
  active: number;
  archived: number;
  unavailable: boolean;
}> {
  const [totalResult, activeResult] = await Promise.all([
    supabase.from("tasks").select("id", { count: "exact", head: true }),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .is("archived_at", null),
  ]);

  const unavailable = isTasksArchivedAtMissing(activeResult.error);
  if (totalResult.error || (activeResult.error && !unavailable)) {
    const error = totalResult.error ?? activeResult.error;
    throw new Error(`Failed to load task summary: ${error?.message ?? "unknown error"}`);
  }

  if (unavailable) {
    return { total: 0, active: 0, archived: 0, unavailable: true };
  }

  const total = totalResult.count ?? 0;
  const active = activeResult.count ?? 0;
  return { total, active, archived: Math.max(0, total - active), unavailable: false };
}

const CALENDAR_ROW_CAP = 500;

export async function getTasksWorkspaceData(
  filters: TasksWorkspaceFilters,
  options?: {
    supabase?: SupabaseServerClient;
    todayIsoDate?: string;
    calendar?: TasksWorkspaceCalendarOptions;
  },
): Promise<TasksWorkspaceData> {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const todayIsoDate = options?.todayIsoDate ?? getTodayLocalIsoDate();
  const calendarRange = options?.calendar
    ? buildCalendarRange({
        view: options.calendar.view,
        anchorDate: options.calendar.anchorDate,
        timezone: options.calendar.timezone,
      })
    : null;
  const calendarDateColumn =
    options?.calendar?.dateField === "planned" ? "planned_for_date" : "due_date";
  const savedViewSelectWithDefinition =
    "id, name, status, project_id, goal_id, due_filter, sort_value, definition_json, updated_at";
  const savedViewSelectLegacy =
    "id, name, status, project_id, goal_id, due_filter, sort_value, updated_at";
  const [projectsResult, goalsResult, initialSavedViewsResult, taskSummary] = await Promise.all([
    supabase.from("projects").select("id, name, slug").order("name", { ascending: true }),
    supabase
      .from("goals")
      .select("id, title, project_id")
      .order("created_at", { ascending: false }),
    supabase
      .from("task_saved_views")
      .select(savedViewSelectWithDefinition)
      .order("updated_at", { ascending: false }),
    getTasksSummary(supabase),
  ]);
  let savedViewsResult: {
    data: TaskSavedViewSelectRow[] | null;
    error: typeof initialSavedViewsResult.error;
  } = initialSavedViewsResult;

  if (isTaskSavedViewDefinitionJsonMissing(initialSavedViewsResult.error)) {
    savedViewsResult = await supabase
      .from("task_saved_views")
      .select(savedViewSelectLegacy)
      .order("updated_at", { ascending: false });
  }

  if (projectsResult.error) {
    throw new Error(`Failed to load projects: ${projectsResult.error.message}`);
  }

  if (goalsResult.error) {
    throw new Error(`Failed to load goals: ${goalsResult.error.message}`);
  }

  const savedViewsUnavailable = isMissingSupabaseTable(
    savedViewsResult.error,
    "public.task_saved_views",
  );

  if (savedViewsResult.error && !savedViewsUnavailable) {
    throw new Error(`Failed to load saved views: ${savedViewsResult.error.message}`);
  }

  const activeProjectId =
    filters.requestedProjectId &&
    projectsResult.data.some((project) => project.id === filters.requestedProjectId)
      ? filters.requestedProjectId
      : null;
  const visibleGoals = activeProjectId
    ? goalsResult.data.filter((goal) => goal.project_id === activeProjectId)
    : goalsResult.data;
  const activeGoalId =
    filters.requestedGoalId && visibleGoals.some((goal) => goal.id === filters.requestedGoalId)
      ? filters.requestedGoalId
      : null;

  const baseView =
    filters.view ??
    taskViewFromLegacyInput({
      status: filters.activeStatus,
      priority: filters.activePriorityValues,
      projectId: activeProjectId,
      goalId: activeGoalId,
      due: filters.activeDueFilter,
      dueWithinDays: filters.activeDueWithinDays,
      estimateMinMinutes: filters.activeEstimateMinMinutes,
      estimateMaxMinutes: filters.activeEstimateMaxMinutes,
      sort: filters.activeSort,
      activeOnly: filters.activeTasksOnly,
    });
  const projectIds = new Set(projectsResult.data.map((project) => project.id));
  const visibleGoalIds = new Set(visibleGoals.map((goal) => goal.id));
  const scopedView =
    normalizeTaskViewDefinition({
      ...baseView,
      filters: baseView.filters.flatMap((filter) => {
        if (filter.field === "project") {
          const values = filter.values.filter((value) => projectIds.has(value));
          return values.length > 0 ? [{ ...filter, values }] : [];
        }
        if (filter.field === "goal") {
          const values = filter.values.filter((value) => visibleGoalIds.has(value));
          return values.length > 0 ? [{ ...filter, values }] : [];
        }
        return [filter];
      }),
    }) ?? baseView;

  const applyQuery = (query: TaskReadQuery): TaskReadQuery => {
    if (activeProjectId) query = query.eq("project_id", activeProjectId);
    if (activeGoalId) query = query.eq("goal_id", activeGoalId);

    let dueWindowApplied = false;

    for (const filter of scopedView.filters) {
      if (filter.field === "status") {
        query =
          filter.operator === "is"
            ? query.eq("status", filter.values[0])
            : filter.operator === "is_not"
              ? query.neq("status", filter.values[0])
              : filter.operator === "is_any_of"
                ? query.in("status", filter.values)
                : query.not("status", "in", `(${filter.values.join(",")})`);
      } else if (filter.field === "priority") {
        query =
          filter.operator === "is"
            ? query.eq("priority", filter.values[0])
            : filter.operator === "is_not"
              ? query.neq("priority", filter.values[0])
              : filter.operator === "is_any_of"
                ? query.in("priority", filter.values)
                : query.not("priority", "in", `(${filter.values.join(",")})`);
      } else if (filter.field === "project" || filter.field === "goal") {
        const column = filter.field === "project" ? "project_id" : "goal_id";
        if (filter.operator === "is") query = query.eq(column, filter.values[0]);
        if (filter.operator === "is_any_of") query = query.in(column, filter.values);
      } else if (filter.field === "estimate") {
        if (filter.values[0] !== "") query = query.gte("estimate_minutes", Number(filter.values[0]));
        if (filter.values[1] !== "") query = query.lte("estimate_minutes", Number(filter.values[1]));
      } else if (filter.field === "due_within_days") {
        if (!dueWindowApplied) {
          dueWindowApplied = true;
          query = query
            .gte("due_date", todayIsoDate)
            .lte("due_date", shiftDateOnlyValue(todayIsoDate, Number(filter.values[0])));
        }
      } else if (filter.field === "due_bucket" && filter.operator === "is") {
        const bucket = filter.values[0];
        if (bucket === "none") query = query.is("due_date", null);
        if (!dueWindowApplied && bucket === "overdue") {
          dueWindowApplied = true;
          query = query.lt("due_date", todayIsoDate).neq("status", "done");
        }
        if (!dueWindowApplied && bucket === "today") {
          dueWindowApplied = true;
          query = query.eq("due_date", todayIsoDate).neq("status", "done");
        }
        if (!dueWindowApplied && bucket === "next_7_days") {
          dueWindowApplied = true;
          query = query
            .gte("due_date", todayIsoDate)
            .lte("due_date", shiftDateOnlyValue(todayIsoDate, 7))
            .neq("status", "done");
        }
      }
    }

    if (scopedView.activeOnly) query = query.neq("status", "done");
    if (scopedView.search) {
      query = query.ilike("title", `%${scopedView.search.replace(/[\\%_]/g, "\\$&")}%`);
    }

    if (calendarRange) {
      // Bound the read to the visible grid: only tasks whose selected date
      // field falls inside the window are loaded, never the first page of an
      // unrelated global list.
      query = query
        .gte(calendarDateColumn, calendarRange.startDate)
        .lte(calendarDateColumn, calendarRange.endDate)
        .limit(CALENDAR_ROW_CAP);
    }

    return query;
  };

  const archiveFilter = filters.activeView === "all" ? "all" : filters.activeView;
  const tasksResult = await getActiveTasksForOwner({ supabase, archiveFilter, applyQuery });

  if (tasksResult.errorMessage) {
    throw new Error(`Failed to load tasks: ${tasksResult.errorMessage}`);
  }

  const rawTasks = tasksResult.data;
  // Only pay for an exact count when the page could be truncated; a short page
  // is already the complete filtered set.
  const countResult =
    rawTasks.length >= TASK_READ_PAGE_SIZE &&
    canExactlyCountTaskViewFilters(scopedView.filters)
      ? await getTaskCountForOwner({ supabase, archiveFilter, applyQuery })
      : { count: null, errorMessage: null };
  const viewRecords: TaskViewRecord[] = rawTasks.map((task) => ({
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    projectId: task.project_id,
    projectName: task.projects?.name ?? null,
    goalId: task.goal_id,
    goalTitle: task.goals?.title ?? null,
    dueDate: task.due_date,
    plannedForDate: task.planned_for_date,
    estimateMinutes: task.estimate_minutes,
    boardRank: task.board_rank,
    focusRank: task.focus_rank,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
  }));
  const viewResult = applyTaskView(viewRecords, scopedView, {
    today: todayIsoDate,
    totalCount: countResult.errorMessage ? null : countResult.count,
  });
  const recordsById = new Map(rawTasks.map((task) => [task.id, task]));
  const tasks = viewResult.items
    .map((record) => recordsById.get(record.id))
    .filter((task): task is (typeof rawTasks)[number] => Boolean(task));

  const taskIds = tasks.map((task) => task.id);
  const [taskTotalDurations, taskRemindersByTaskId, taskRecurrencesByTaskId] = await Promise.all([
    getTaskTotalDurationMap(supabase, taskIds),
    getTaskRemindersForTasks(supabase, taskIds),
    getTaskRecurrencesForTasks(supabase, taskIds),
  ]);
  const tasksWithReminders = tasks.map((task) => ({
    ...task,
    task_reminders: taskRemindersByTaskId[task.id] ?? [],
    task_recurrences: taskRecurrencesByTaskId[task.id] ?? [],
  }));

  let calendar: TaskCalendarProjection | null = null;
  if (calendarRange && options?.calendar) {
    const userId = await getAuthenticatedUserId(supabase);
    const taskCalendarSelect =
      "id, title, status, priority, due_date, planned_for_date, scheduled_start_at, scheduled_end_at, calendar_sync_enabled, updated_at, projects(name)";

    let scheduledQuery = supabase
      .from("tasks")
      .select(taskCalendarSelect)
      .lt("scheduled_start_at", calendarRange.endUtcIso)
      .gt("scheduled_end_at", calendarRange.startUtcIso);
    if (userId) scheduledQuery = scheduledQuery.eq("owner_user_id", userId);
    if (filters.activeView === "active") {
      scheduledQuery = scheduledQuery.is("archived_at", null);
    } else if (filters.activeView === "archived") {
      scheduledQuery = scheduledQuery.not("archived_at", "is", null);
    }
    if (filters.activeStatus) {
      scheduledQuery = scheduledQuery.eq("status", filters.activeStatus);
    }
    if (filters.activeTasksOnly) {
      scheduledQuery = scheduledQuery.neq("status", "done");
    }
    if (activeProjectId) {
      scheduledQuery = scheduledQuery.eq("project_id", activeProjectId);
    }
    if (activeGoalId) {
      scheduledQuery = scheduledQuery.eq("goal_id", activeGoalId);
    }
    const scheduledResult = await scheduledQuery
      .order("scheduled_start_at", { ascending: true })
      .limit(CALENDAR_ROW_CAP);

    if (scheduledResult.error) {
      throw new Error(`Failed to load calendar schedule: ${scheduledResult.error.message}`);
    }

    let sessionsQuery = supabase
      .from("task_sessions")
      .select("id, task_id, started_at, ended_at")
      .lt("started_at", calendarRange.endUtcIso)
      .or(`ended_at.is.null,ended_at.gt.${calendarRange.startUtcIso}`)
      .order("started_at", { ascending: true })
      .limit(CALENDAR_ROW_CAP);
    if (userId) sessionsQuery = sessionsQuery.eq("owner_user_id", userId);
    const sessionsResult = await sessionsQuery;

    if (sessionsResult.error) {
      throw new Error(`Failed to load calendar sessions: ${sessionsResult.error.message}`);
    }

    const sessionRows = (sessionsResult.data ?? []) as Array<{
      id: string;
      task_id: string;
      started_at: string;
      ended_at: string | null;
    }>;
    const sessionTaskIds = Array.from(new Set(sessionRows.map((session) => session.task_id)));
    let sessionTaskTitles = new Map<string, string>();
    if (sessionTaskIds.length > 0) {
      let sessionTasksQuery = supabase
        .from("tasks")
        .select("id, title")
        .in("id", sessionTaskIds);
      if (userId) sessionTasksQuery = sessionTasksQuery.eq("owner_user_id", userId);
      const sessionTasksResult = await sessionTasksQuery;
      if (sessionTasksResult.error) {
        throw new Error(
          `Failed to load calendar session tasks: ${sessionTasksResult.error.message}`,
        );
      }
      sessionTaskTitles = new Map(
        (sessionTasksResult.data ?? []).map((task) => [task.id, task.title]),
      );
    }

    const scheduledTasks = (scheduledResult.data ?? []) as unknown as CalendarProjectableTask[];
    const sessions: CalendarProjectableSession[] = sessionRows.map((session) => ({
      id: session.id,
      taskId: session.task_id,
      title: sessionTaskTitles.get(session.task_id) ?? "Deleted task",
      startIso: session.started_at,
      endIso: session.ended_at,
    }));

    calendar = buildTaskCalendarProjection({
      range: calendarRange,
      view: options.calendar.view,
      dateField: options.calendar.dateField,
      todayDate: todayIsoDate,
      tasks: tasksWithReminders as unknown as CalendarProjectableTask[],
      scheduledTasks,
      sessions,
      truncated:
        tasks.length >= CALENDAR_ROW_CAP ||
        scheduledTasks.length >= CALENDAR_ROW_CAP ||
        sessions.length >= CALENDAR_ROW_CAP,
    });
  }

  return {
    projects: projectsResult.data,
    goals: visibleGoals,
    tasks: tasksWithReminders,
    taskTotalDurations,
    summary: taskSummary.unavailable
      ? { total: tasks.length, active: tasks.length, archived: 0 }
      : {
          total: taskSummary.total,
          active: taskSummary.active,
          archived: taskSummary.archived,
        },
    savedViews: savedViewsUnavailable
      ? []
      : [
          ...SYSTEM_TASK_SAVED_VIEWS.map((view, index) => ({
            id: view.id,
            name: view.name,
            status: null,
            project_id: null,
            goal_id: null,
            due_filter: "all",
            sort_value: "updated_desc",
            definition_json: view.definition_json,
            updated_at: `2026-04-30T00:00:0${index}.000Z`,
            is_default: true,
          })),
          ...(savedViewsResult.data ?? []).map((view) => {
            const definition = getTaskViewFromSavedView({
              definitionJson: "definition_json" in view ? view.definition_json : null,
              status: view.status,
              projectId: view.project_id,
              goalId: view.goal_id,
              dueFilter: view.due_filter,
              sortValue: view.sort_value,
            });
            const definitionFilters = getTaskSavedViewFiltersFromDefinition(definition);
            const legacyFilters = normalizeTaskSavedViewFilters({
              status: definitionFilters.status ?? view.status,
              projectId: definitionFilters.projectId ?? view.project_id,
              goalId: definitionFilters.goalId ?? view.goal_id,
              dueFilter: view.due_filter ?? "all",
              sortValue: view.sort_value ?? "updated_desc",
              activeTasks: definitionFilters.activeTasks,
              priority: definitionFilters.priorityValues,
              estimateMinMinutes: definitionFilters.estimateMinMinutes,
              estimateMaxMinutes: definitionFilters.estimateMaxMinutes,
              dueWithinDays: definitionFilters.dueWithinDays,
            });

            return {
              id: view.id,
              name: view.name,
              status: legacyFilters.status,
              project_id: legacyFilters.projectId,
              goal_id: legacyFilters.goalId,
              due_filter: legacyFilters.dueFilter,
              sort_value: legacyFilters.sortValue,
              definition_json:
                definition ?? getTaskSavedViewDefinitionFromFilters(legacyFilters),
              updated_at: view.updated_at,
            };
          }),
        ],
    savedViewsUnavailable,
    activeProjectId,
    activeGoalId,
    view: scopedView,
    filteredTotal: viewResult.totalCount,
    loadedCount: viewResult.loadedCount,
    truncated: viewResult.truncated,
    calendar,
  };
}

export async function createTasks(
  taskRows: TablesInsert<"tasks">[],
  options?: CreateTasksOptions,
) {
  const supabase = await resolveSupabaseClient(options?.supabase);

  if (taskRows.length === 0) {
    return { errorMessage: "No tasks were provided." };
  }

  const taskScope = await getVisibleTaskScope(supabase);

  if (taskScope.errorMessage !== null) {
    return { errorMessage: taskScope.errorMessage };
  }

  for (const row of taskRows) {
    if (row.title.length > TASK_TITLE_MAX) return { errorMessage: TASK_TITLE_LENGTH_ERROR };
    const statusValue = String(row.status ?? "todo").trim();
    const blockedReason = normalizeTaskBlockedReasonInput(row.blocked_reason);

    if (statusValue === "blocked" && !blockedReason) {
      return { errorMessage: "Blocked reason is required when status is Blocked." };
    }

    row.blocked_reason = statusValue === "blocked" ? blockedReason : null;
    if (statusValue === "done" && !row.completed_at) {
      row.completed_at = new Date().toISOString();
    }
    const scopeError = getTaskInsertScopeError(row, taskScope.scope);
    if (scopeError) {
      return { errorMessage: scopeError };
    }
  }

  let { data, error } = await supabase.from("tasks").insert(taskRows).select("id");

  if (error && isTasksBlockedReasonMissing(error)) {
    const fallbackRows = taskRows.map((row) => {
      const nextRow = { ...row };
      delete (nextRow as { blocked_reason?: unknown }).blocked_reason;
      return nextRow;
    });
    const fallbackResult = await supabase.from("tasks").insert(fallbackRows).select("id");
    data = fallbackResult.data;
    error = fallbackResult.error;
  }

  if (error) {
    if (error.code === "22001") return { errorMessage: TASK_TITLE_LENGTH_ERROR };
    console.error("Task insert failed", { code: error.code });
    return { errorMessage: "Unable to create task right now." };
  }

  const createdTaskIds = (data ?? []).map((row) => row.id);
  const calendarSyncErrors = await enqueueCreatedTasksForCalendarSync(
    supabase,
    taskRows,
    createdTaskIds,
  );

  return {
    errorMessage: null,
    createdTaskIds,
    ...(calendarSyncErrors.length > 0 ? { calendarSyncErrors } : {}),
  };
}

export async function createTaskWithOptionalWorkedTime(
  input: {
    task: TablesInsert<"tasks">;
    workedTime?: ManualWorkedTimePayload | null;
    recurrenceRule?: unknown;
    recurrenceAnchorDate?: unknown;
    recurrenceTimezone?: unknown;
  },
  options?: CreateTasksOptions,
) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const fallbackAnchorDate = input.task.due_date ?? options?.fallbackAnchorDate ?? getTodayLocalIsoDate();
  const recurrenceResult =
    input.recurrenceRule === undefined
      ? { errorMessage: null, schedule: undefined }
      : normalizeTaskRecurrenceScheduleInput({
          rule: input.recurrenceRule,
          anchorDate: input.recurrenceAnchorDate,
          timezone: input.recurrenceTimezone,
          defaultTimezone: options?.recurrenceDefaultTimezone,
          fallbackAnchorDate,
        });

  if (recurrenceResult.errorMessage) {
    return {
      errorMessage: recurrenceResult.errorMessage,
      createdTaskId: null,
      workedTimeLogged: false,
    };
  }

  const createResult = await createTasks([input.task], {
    supabase,
    calendarClient: options?.calendarClient,
  });

  if (createResult.errorMessage !== null) {
    return {
      errorMessage: createResult.errorMessage,
      createdTaskId: null,
      workedTimeLogged: false,
    };
  }

  const createdTaskId = createResult.createdTaskIds?.[0] ?? null;
  const calendarSyncErrors =
    "calendarSyncErrors" in createResult ? createResult.calendarSyncErrors : undefined;
  if (createdTaskId && recurrenceResult.schedule) {
    const setRecurrenceResult = await setTaskRecurrence(
      {
        taskId: createdTaskId,
        recurrenceRule: recurrenceResult.schedule.rule,
        recurrenceAnchorDate: recurrenceResult.schedule.anchorDate,
        recurrenceTimezone: recurrenceResult.schedule.timezone,
      },
      { supabase, fallbackAnchorDate },
    );

    if (setRecurrenceResult.errorMessage) {
      return {
        errorMessage: setRecurrenceResult.errorMessage,
        createdTaskId,
        workedTimeLogged: false,
      };
    }
  }

  if (!input.workedTime) {
    return {
      errorMessage: null,
      createdTaskId,
      workedTimeLogged: false,
      ...(calendarSyncErrors?.length ? { calendarSyncErrors } : {}),
    };
  }

  if (!createdTaskId) {
    return {
      errorMessage: "Task created, but worked time could not be logged.",
      createdTaskId: null,
      workedTimeLogged: false,
    };
  }

  const { error } = await supabase.from("task_sessions").insert({
    task_id: createdTaskId,
    started_at: input.workedTime.started_at,
    ended_at: input.workedTime.ended_at,
    duration_seconds: input.workedTime.duration_seconds,
  });

  if (error) {
    return {
      errorMessage: "Task created, but worked time could not be logged.",
      createdTaskId,
      workedTimeLogged: false,
    };
  }

  return {
    errorMessage: null,
    createdTaskId,
    workedTimeLogged: true,
    ...(calendarSyncErrors?.length ? { calendarSyncErrors } : {}),
  };
}

export async function createTaskEmailReminder(
  input: {
    taskId: string;
    remindAt: unknown;
    channel?: unknown;
    status?: unknown;
    timezone?: string;
  },
  options?: { supabase?: SupabaseServerClient; now?: Date },
) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const validationResult = normalizeTaskReminderCreateInput({
    ...input,
    now: options?.now,
  });

  if (validationResult.errorMessage || !validationResult.data) {
    return {
      errorMessage: validationResult.errorMessage ?? "Reminder request is invalid.",
      data: null,
    };
  }

  const taskResult = await getVisibleTaskById(supabase, validationResult.data.taskId);
  if (taskResult.errorMessage) {
    return {
      errorMessage: taskResult.errorMessage,
      data: null,
    };
  }

  const { data, error } = await supabase
    .from("task_reminders")
    .insert({
      task_id: validationResult.data.taskId,
      remind_at: validationResult.data.remindAtIso,
      channel: validationResult.data.channel,
      status: validationResult.data.status,
    })
    .select(
      "id, task_id, remind_at, channel, status, sent_at, failure_reason, created_at, updated_at",
    )
    .maybeSingle();

  if (error) {
    return {
      errorMessage: "Unable to create reminder right now.",
      data: null,
    };
  }

  if (!data) {
    return {
      errorMessage: "Reminder could not be created.",
      data: null,
    };
  }

  return {
    errorMessage: null,
    data: normalizeTaskReminderRow(data),
  };
}

export async function updateTaskEmailReminder(
  input: {
    taskId: string;
    reminderId: string;
    remindAt: unknown;
    channel?: unknown;
    status?: unknown;
    timezone?: string;
  },
  options?: { supabase?: SupabaseServerClient; now?: Date; updatedAtIso?: string },
) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const reminderId = input.reminderId.trim();
  const validationResult = normalizeTaskReminderCreateInput({
    taskId: input.taskId,
    remindAt: input.remindAt,
    channel: input.channel,
    status: input.status,
    timezone: input.timezone,
    now: options?.now,
  });

  if (!reminderId) {
    return {
      errorMessage: "Reminder update request is invalid.",
      data: null,
    };
  }

  if (validationResult.errorMessage || !validationResult.data) {
    return {
      errorMessage: validationResult.errorMessage ?? "Reminder update request is invalid.",
      data: null,
    };
  }

  const taskResult = await getVisibleTaskById(supabase, validationResult.data.taskId);
  if (taskResult.errorMessage) {
    return {
      errorMessage: taskResult.errorMessage,
      data: null,
    };
  }

  const updatedAtIso = options?.updatedAtIso ?? new Date().toISOString();
  const { data, error } = await supabase
    .from("task_reminders")
    .update({
      remind_at: validationResult.data.remindAtIso,
      channel: validationResult.data.channel,
      status: "pending",
      updated_at: updatedAtIso,
    })
    .eq("id", reminderId)
    .eq("task_id", validationResult.data.taskId)
    .eq("status", "pending")
    .select(
      "id, task_id, remind_at, channel, status, sent_at, failure_reason, created_at, updated_at",
    )
    .maybeSingle();

  if (error) {
    return {
      errorMessage: "Unable to update reminder right now.",
      data: null,
    };
  }

  if (!data) {
    return {
      errorMessage: "Pending reminder was not found or is no longer editable.",
      data: null,
    };
  }

  return {
    errorMessage: null,
    data: normalizeTaskReminderRow(data),
  };
}

export async function cancelTaskReminder(
  input: {
    taskId: string;
    reminderId: string;
    status?: unknown;
  },
  options?: { supabase?: SupabaseServerClient; updatedAtIso?: string },
) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const updatedAtIso = options?.updatedAtIso ?? new Date().toISOString();
  const validationResult = normalizeTaskReminderCancelInput(input);

  if (validationResult.errorMessage || !validationResult.data) {
    return {
      errorMessage: validationResult.errorMessage ?? "Reminder cancel request is invalid.",
      data: null,
    };
  }

  const taskResult = await getVisibleTaskById(supabase, validationResult.data.taskId);
  if (taskResult.errorMessage) {
    return {
      errorMessage: taskResult.errorMessage,
      data: null,
    };
  }

  const { data, error } = await supabase
    .from("task_reminders")
    .update({
      status: validationResult.data.status,
      updated_at: updatedAtIso,
    })
    .eq("id", validationResult.data.reminderId)
    .eq("task_id", validationResult.data.taskId)
    .eq("status", "pending")
    .select(
      "id, task_id, remind_at, channel, status, sent_at, failure_reason, created_at, updated_at",
    )
    .maybeSingle();

  if (error) {
    return {
      errorMessage: "Unable to cancel reminder right now.",
      data: null,
    };
  }

  if (!data) {
    return {
      errorMessage: "Pending reminder was not found or is no longer cancellable.",
      data: null,
    };
  }

  return {
    errorMessage: null,
    data: normalizeTaskReminderRow(data),
  };
}

export function validateTaskInlineUpdateInput(input: ValidateTaskInlineUpdateInput) {
  const taskId = input.taskId.trim();
  const title = input.title === undefined ? undefined : String(input.title ?? "").trim();
  const projectId =
    input.projectId === undefined ? undefined : String(input.projectId ?? "").trim();
  const goalId =
    input.goalId === undefined ? undefined : String(input.goalId ?? "").trim() || null;
  const description =
    input.description === undefined
      ? undefined
      : String(input.description ?? "").trim() || null;
  const status = input.status.trim();
  const priority = input.priority.trim();
  const startDateResult =
    input.startDate === undefined
      ? { value: undefined, error: null }
      : normalizeTaskStartDateInput(input.startDate);
  const dueDateResult = normalizeTaskDueDateInput(input.dueDate);
  const plannedForDateResult =
    input.plannedForDate === undefined
      ? { value: undefined as string | null | undefined, error: null as string | null }
      : normalizeTaskPlannedDateInput(input.plannedForDate);
  const estimateResult = normalizeTaskEstimateInput(input.estimateMinutes);
  const blockedReason = normalizeTaskBlockedReasonInput(input.blockedReason);
  const recurrenceRuleResult =
    input.recurrenceRule === undefined
      ? { errorMessage: null, schedule: undefined }
      : normalizeTaskRecurrenceScheduleInput({
          rule: input.recurrenceRule,
          anchorDate: input.recurrenceAnchorDate,
          timezone: input.recurrenceTimezone,
          defaultTimezone: input.accountTimezone,
          fallbackAnchorDate: dueDateResult.value ?? input.fallbackAnchorDate ?? getTodayLocalIsoDate(),
        });
  const hasScheduleFields =
    input.scheduledStartAt !== undefined || input.scheduledEndAt !== undefined;
  const hasCalendarFields =
    input.calendarSyncEnabled !== undefined || input.calendarReminderMinutes !== undefined;
  const scheduleResult = hasScheduleFields
    ? normalizeTaskScheduleInput({
        scheduledStartAt: input.scheduledStartAt ?? "",
        scheduledEndAt: input.scheduledEndAt ?? "",
        timezone: input.accountTimezone ?? "UTC",
      })
    : null;

  if (!taskId) {
    return {
      errorMessage: "Task update request is invalid.",
    };
  }

  if (title !== undefined && !title) {
    return {
      errorMessage: "Task title is required.",
    };
  }

  if (title !== undefined && title.length > TASK_TITLE_MAX) {
    return { errorMessage: TASK_TITLE_LENGTH_ERROR };
  }

  if (projectId !== undefined && !projectId) {
    return {
      errorMessage: "Project is required.",
    };
  }

  if (!isTaskStatus(status)) {
    return {
      errorMessage: `Status must be one of: ${TASK_STATUS_VALUES.join(", ")}.`,
    };
  }

  if (!isTaskPriority(priority)) {
    return {
      errorMessage: `Priority must be one of: ${TASK_PRIORITY_VALUES.join(", ")}.`,
    };
  }

  if (startDateResult.error) {
    return {
      errorMessage: startDateResult.error,
    };
  }

  if (dueDateResult.error) {
    return {
      errorMessage: dueDateResult.error,
    };
  }

  if (startDateResult.value && dueDateResult.value && dueDateResult.value < startDateResult.value) {
    return {
      errorMessage: "Due date cannot be before the start date.",
    };
  }

  if (plannedForDateResult.error) {
    return {
      errorMessage: plannedForDateResult.error,
    };
  }

  if (estimateResult.error) {
    return {
      errorMessage: estimateResult.error,
    };
  }

  if (recurrenceRuleResult.errorMessage) {
    return {
      errorMessage: recurrenceRuleResult.errorMessage,
    };
  }

  if (scheduleResult?.error) {
    return {
      errorMessage: scheduleResult.error,
    };
  }

  const blockedReasonError = getTaskBlockedReasonValidationError(status, blockedReason);
  if (blockedReasonError) {
    return {
      errorMessage: blockedReasonError,
    };
  }

  const normalizedBlockedReason = status === "blocked" ? blockedReason : null;

  return {
    errorMessage: null,
    data: {
      taskId,
      ...(title === undefined ? {} : { title }),
      ...(projectId === undefined ? {} : { projectId }),
      ...(goalId === undefined ? {} : { goalId }),
      ...(description === undefined ? {} : { description }),
      status,
      priority,
      ...(startDateResult.value === undefined ? {} : { startDate: startDateResult.value }),
      dueDate: dueDateResult.value,
      ...(plannedForDateResult.value === undefined
        ? {}
        : { plannedForDate: plannedForDateResult.value }),
      estimateMinutes: estimateResult.value,
      blockedReason: normalizedBlockedReason,
      ...(scheduleResult
        ? {
            scheduledStartAt: scheduleResult.scheduledStartAtIso,
            scheduledEndAt: scheduleResult.scheduledEndAtIso,
          }
        : {}),
      ...(hasCalendarFields
        ? {
            calendarSyncEnabled: input.calendarSyncEnabled === "on",
            calendarReminderMinutes: normalizeCalendarReminderMinutes(
              input.calendarReminderMinutes,
            ),
          }
        : {}),
      ...(input.recurrenceRule === undefined
        ? {}
        : {
            recurrenceRule: recurrenceRuleResult.schedule?.rule ?? null,
            recurrenceAnchorDate: recurrenceRuleResult.schedule?.anchorDate ?? null,
            recurrenceTimezone: recurrenceRuleResult.schedule?.timezone ?? null,
          }),
    } satisfies ValidatedTaskInlineUpdateInput,
  };
}

type RecurringCompletionTaskSnapshot = {
  id: string;
  owner_user_id: string | null;
  project_id: string;
  goal_id: string | null;
  title: string;
  description: string | null;
  priority: string;
  estimate_minutes: number | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
};

async function findExistingGeneratedRecurringTask(
  supabase: SupabaseServerClient,
  task: RecurringCompletionTaskSnapshot,
  dueDate: string,
) {
  let query = supabase
    .from("tasks")
    .select("id")
    .eq("project_id", task.project_id)
    .eq("title", task.title)
    .eq("due_date", dueDate)
    .neq("id", task.id)
    .limit(1);

  query = task.goal_id
    ? query.eq("goal_id", task.goal_id)
    : query.is("goal_id", null);

  if (task.owner_user_id) {
    query = query.eq("owner_user_id", task.owner_user_id);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    return {
      errorMessage: "Unable to verify recurring task generation right now.",
      data: null,
    };
  }

  return {
    errorMessage: null,
    data,
  };
}

export async function generateNextTaskForCompletedRecurrence(
  taskId: string,
  options?: { supabase?: SupabaseServerClient; completedAtIso?: string },
) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const normalizedTaskId = taskId.trim();
  const completedAtIso = options?.completedAtIso ?? new Date().toISOString();

  if (!normalizedTaskId) {
    return { errorMessage: "Task update request is invalid." };
  }

  const { data: recurrenceRow, error: recurrenceError } = await supabase
    .from("task_recurrences")
    .select(
      "id, task_id, rule, anchor_date, timezone, next_occurrence_date, last_generated_at, created_at, updated_at",
    )
    .eq("task_id", normalizedTaskId)
    .maybeSingle();

  if (recurrenceError) {
    return { errorMessage: "Unable to load recurring preset right now." };
  }

  if (!recurrenceRow) {
    return { errorMessage: null };
  }

  const recurrence = normalizeTaskRecurrenceRow(recurrenceRow);
  if (!recurrence) {
    return { errorMessage: "Recurring preset is not supported." };
  }

  const generationDate = getFirstTaskRecurrenceDateAfter({
    rule: recurrence.rule,
    anchorDate: recurrence.anchor_date,
    nextOccurrenceDate: recurrence.next_occurrence_date,
    completedAtIso,
    timezone: recurrence.timezone,
  });
  if (!generationDate) {
    return { errorMessage: "Recurring next occurrence date is invalid." };
  }

  const nextOccurrenceDate = getNextTaskRecurrenceDateFromAnchor(
    recurrence.rule,
    generationDate,
    recurrence.anchor_date,
  );
  if (!nextOccurrenceDate) {
    return { errorMessage: "Recurring next occurrence date is invalid." };
  }

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select(
      "id, owner_user_id, project_id, goal_id, title, description, priority, estimate_minutes, scheduled_start_at, scheduled_end_at",
    )
    .eq("id", normalizedTaskId)
    .maybeSingle();

  if (taskError) {
    return { errorMessage: "Unable to load task right now." };
  }

  if (!task) {
    return { errorMessage: "Task was not found or is no longer available." };
  }

  const existingResult = await findExistingGeneratedRecurringTask(
    supabase,
    task,
    generationDate,
  );
  if (existingResult.errorMessage) {
    return { errorMessage: existingResult.errorMessage };
  }

  if (existingResult.data) {
    const { error } = await supabase
      .from("task_recurrences")
      .update({
        last_generated_at: completedAtIso,
        next_occurrence_date: nextOccurrenceDate,
        updated_at: completedAtIso,
      })
      .eq("id", recurrence.id);

    return {
      errorMessage: error ? "Unable to update recurring preset right now." : null,
    };
  }

  const { data: claimedRecurrence, error: claimError } = await supabase
    .from("task_recurrences")
    .update({
      last_generated_at: completedAtIso,
      next_occurrence_date: nextOccurrenceDate,
      updated_at: completedAtIso,
    })
    .eq("id", recurrence.id)
    .is("last_generated_at", null)
    .select("id")
    .maybeSingle();

  if (claimError) {
    return { errorMessage: "Unable to update recurring preset right now." };
  }

  if (!claimedRecurrence) {
    return { errorMessage: null };
  }

  const { data: createdTask, error: createError } = await supabase
    .from("tasks")
    .insert({
      owner_user_id: task.owner_user_id,
      project_id: task.project_id,
      goal_id: task.goal_id,
      title: task.title,
      description: task.description,
      blocked_reason: null,
      status: "todo",
      priority: task.priority,
      due_date: generationDate,
      planned_for_date: null,
      estimate_minutes: task.estimate_minutes,
      scheduled_start_at: null,
      scheduled_end_at: null,
      focus_rank: null,
      completed_at: null,
      archived_at: null,
      archived_by: null,
      updated_at: completedAtIso,
    } satisfies TablesInsert<"tasks">)
    .select("id")
    .maybeSingle();

  if (createError || !createdTask) {
    return { errorMessage: "Unable to create next recurring task right now." };
  }

  const { error: createRecurrenceError } = await supabase.from("task_recurrences").insert({
    owner_user_id: task.owner_user_id,
    task_id: createdTask.id,
    rule: recurrence.rule,
    anchor_date: recurrence.anchor_date,
    timezone: recurrence.timezone,
    next_occurrence_date: nextOccurrenceDate,
    last_generated_at: null,
    updated_at: completedAtIso,
  });

  if (createRecurrenceError) {
    return { errorMessage: "Unable to link next recurring task right now." };
  }

  return { errorMessage: null };
}

export async function updateTaskInline(
  input: ValidatedTaskInlineUpdateInput,
  options?: {
    supabase?: SupabaseServerClient;
    updatedAtIso?: string;
    /**
     * Optimistic-concurrency precondition: the row must still carry this
     * `updated_at` or the write is rejected. Used by single-field patches so a
     * second editor cannot silently write back the values it read earlier.
     */
    expectedUpdatedAt?: string;
    /**
     * Board position for a card move (EGA-785). `null` explicitly means "append
     * to the end of the column"; the database trigger assigns the append key.
     * Provided together with `status` so status + order commit in one row write.
     */
    boardRank?: string | null;
    /**
     * Canonical account local date (YYYY-MM-DD) from the owner's Time Context.
     * Used as the recurrence anchor fallback instead of the runtime-local date
     * so web writes agree with the Hono transport near account midnight.
     */
    fallbackAnchorDate?: string;
  },
) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  if (input.title !== undefined && input.title.length > TASK_TITLE_MAX) {
    return { errorMessage: TASK_TITLE_LENGTH_ERROR };
  }
  const updatedAtIso = options?.updatedAtIso ?? new Date().toISOString();

  let { data: currentTask, error: currentTaskError } = await supabase
    .from("tasks")
    .select("id, owner_user_id, project_id, goal_id, status, start_date, due_date, completed_at, archived_at, updated_at")
    .eq("id", input.taskId)
    .maybeSingle();
  let completedAtUnavailable = false;

  if (currentTaskError && isMissingTasksCompletedAtColumn(currentTaskError)) {
    const fallbackResult = await supabase
      .from("tasks")
      .select("id, owner_user_id, project_id, goal_id, status, start_date, due_date, archived_at, updated_at")
      .eq("id", input.taskId)
      .maybeSingle();

    currentTask = fallbackResult.data
      ? { ...fallbackResult.data, completed_at: null }
      : null;
    currentTaskError = fallbackResult.error;
    completedAtUnavailable = true;
  }

  if (currentTaskError) {
    return { errorMessage: "Unable to load task right now." };
  }

  if (!currentTask) {
    return { errorMessage: "Task was not found or is no longer available." };
  }

  const effectiveStartDate =
    input.startDate !== undefined ? input.startDate : currentTask.start_date ?? null;
  const effectiveDueDate =
    input.dueDate !== undefined ? input.dueDate : currentTask.due_date ?? null;
  if (effectiveStartDate && effectiveDueDate && effectiveDueDate < effectiveStartDate) {
    return { errorMessage: "Due date cannot be before the start date." };
  }

  if (input.projectId !== undefined || input.goalId !== undefined) {
    const scopeResult = await getVisibleTaskScope(supabase);
    if (scopeResult.errorMessage !== null) {
      return { errorMessage: scopeResult.errorMessage };
    }

    const effectiveProjectId = input.projectId ?? currentTask.project_id;
    const effectiveGoalId =
      input.goalId !== undefined ? input.goalId : currentTask.goal_id;

    if (!scopeResult.scope.projectIds.has(effectiveProjectId)) {
      return { errorMessage: "Selected project is unavailable." };
    }

    if (effectiveGoalId) {
      const goal = scopeResult.scope.goalsById.get(effectiveGoalId);
      if (!goal) {
        return { errorMessage: "Selected goal is unavailable." };
      }
      if (goal.project_id !== effectiveProjectId) {
        return { errorMessage: "Selected goal does not belong to the chosen project." };
      }
    }
  }

  if (input.status === "done" && !isTaskCompletedStatus(currentTask.status)) {
    const stopResult = await stopActiveTimerSessionsForTask(input.taskId, {
      supabase,
      nowIso: updatedAtIso,
    });

    if (stopResult.errorMessage) {
      return { errorMessage: stopResult.errorMessage };
    }
  }

  const updatePayload: TablesUpdate<"tasks"> = {
    status: input.status,
    priority: input.priority,
    due_date: input.dueDate,
    estimate_minutes: input.estimateMinutes,
    blocked_reason: input.blockedReason,
    updated_at: updatedAtIso,
  };

  if (input.startDate !== undefined) {
    updatePayload.start_date = input.startDate;
  }

  if (input.plannedForDate !== undefined) {
    updatePayload.planned_for_date = input.plannedForDate;
  }

  if (input.title !== undefined) {
    updatePayload.title = input.title;
  }

  if (input.projectId !== undefined) {
    updatePayload.project_id = input.projectId;
  }

  if (input.goalId !== undefined) {
    updatePayload.goal_id = input.goalId;
  }

  if (input.description !== undefined) {
    updatePayload.description = input.description;
  }

  if (options?.boardRank !== undefined) {
    // Status and order are one row update, so a cross-column move cannot commit
    // a new status with a stale position (or vice versa).
    updatePayload.board_rank = options.boardRank;
  }

  if (input.scheduledStartAt !== undefined) {
    updatePayload.scheduled_start_at = input.scheduledStartAt;
    updatePayload.scheduled_end_at = input.scheduledEndAt ?? null;
  }

  if (input.calendarSyncEnabled !== undefined) {
    updatePayload.calendar_sync_enabled = input.calendarSyncEnabled;
    updatePayload.calendar_reminder_minutes =
      input.calendarReminderMinutes ?? DEFAULT_CALENDAR_REMINDER_MINUTES;
  }

  if (!completedAtUnavailable) {
    updatePayload.completed_at =
      input.status === "done"
        ? isTaskCompletedStatus(currentTask.status) && currentTask.completed_at
          ? currentTask.completed_at
          : updatedAtIso
        : null;
  }

  const expectedUpdatedAt = options?.expectedUpdatedAt;
  const guard = <T extends { eq: (column: string, value: string) => T }>(query: T): T =>
    expectedUpdatedAt ? query.eq("updated_at", expectedUpdatedAt) : query;

  let { data: updatedTask, error } = await guard(
    supabase.from("tasks").update(updatePayload).eq("id", input.taskId),
  )
    .select("id")
    .maybeSingle();

  if (error && isTasksBlockedReasonMissing(error)) {
    const fallbackPayload = { ...updatePayload };
    delete fallbackPayload.blocked_reason;
    const fallbackResult = await guard(
      supabase.from("tasks").update(fallbackPayload).eq("id", input.taskId),
    )
      .select("id")
      .maybeSingle();
    updatedTask = fallbackResult.data;
    error = fallbackResult.error;
  }

  if (error && isMissingTasksCompletedAtColumn(error)) {
    const fallbackPayload = { ...updatePayload };
    delete fallbackPayload.completed_at;
    const fallbackResult = await guard(
      supabase.from("tasks").update(fallbackPayload).eq("id", input.taskId),
    )
      .select("id")
      .maybeSingle();
    updatedTask = fallbackResult.data;
    error = fallbackResult.error;
  }

  if (error) {
    return { errorMessage: "Unable to update task right now." };
  }

  if (!updatedTask) {
    return {
      errorMessage: expectedUpdatedAt
        ? "This task changed since you opened it. Reload and try again."
        : "Task was not found or is no longer available.",
    };
  }

  if (input.recurrenceRule !== undefined) {
    const recurrenceResult = await setTaskRecurrence(
      {
        taskId: input.taskId,
        recurrenceRule: input.recurrenceRule,
        recurrenceAnchorDate: input.recurrenceAnchorDate,
        recurrenceTimezone: input.recurrenceTimezone,
      },
      {
        supabase,
        updatedAtIso,
        fallbackAnchorDate: input.dueDate ?? options?.fallbackAnchorDate ?? getTodayLocalIsoDate(),
      },
    );

    if (recurrenceResult.errorMessage) {
      return { errorMessage: recurrenceResult.errorMessage };
    }
  }

  if (input.status === "done") {
    const recurrenceGenerationResult = await generateNextTaskForCompletedRecurrence(
      input.taskId,
      {
        supabase,
        completedAtIso: updatePayload.completed_at ?? updatedAtIso,
      },
    );

    if (recurrenceGenerationResult.errorMessage) {
      return { errorMessage: recurrenceGenerationResult.errorMessage };
    }
  }

  const shouldEnqueueCalendarSync =
    input.scheduledStartAt !== undefined ||
    input.calendarSyncEnabled !== undefined ||
    input.title !== undefined ||
    input.description !== undefined;

  if (shouldEnqueueCalendarSync) {
    await enqueueCalendarSyncJob(
      {
        taskId: input.taskId,
        ownerUserId: currentTask.owner_user_id,
        operation: "upsert",
      },
      { supabase, nowIso: updatedAtIso },
    );
  }

  return { errorMessage: null };
}

export async function updateTaskArchiveState(
  taskId: string,
  archived: boolean,
  options?: { supabase?: SupabaseServerClient; updatedAtIso?: string },
) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const normalizedTaskId = taskId.trim();
  const updatedAtIso = options?.updatedAtIso ?? new Date().toISOString();

  if (!normalizedTaskId) {
    return { errorMessage: "Task archive request is invalid." };
  }

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id, owner_user_id, archived_at")
    .eq("id", normalizedTaskId)
    .maybeSingle();

  if (taskError && isTasksArchivedAtMissing(taskError)) {
    return { errorMessage: "Unable to archive task right now." };
  }

  if (taskError) {
    return { errorMessage: "Unable to load task right now." };
  }

  if (!task) {
    return { errorMessage: "Task was not found or is no longer available." };
  }

  if (archived) {
    const activeSessionResult = await supabase
      .from("task_sessions")
      .select("id")
      .eq("task_id", normalizedTaskId)
      .is("ended_at", null)
      .limit(1);

    if (activeSessionResult.error) {
      return { errorMessage: "Unable to validate timer sessions for this task right now." };
    }

    if ((activeSessionResult.data ?? []).length > 0) {
      return { errorMessage: "Stop the active timer before archiving this task." };
    }
  }

  const userResult = archived ? await supabase.auth.getUser() : null;
  const archivedBy = archived && !userResult?.error ? userResult?.data.user?.id ?? null : null;

  const { error } = await supabase
    .from("tasks")
    .update({
      archived_at: archived ? updatedAtIso : null,
      archived_by: archivedBy,
      focus_rank: archived ? null : undefined,
      updated_at: updatedAtIso,
    })
    .eq("id", normalizedTaskId);

  if (error) {
    return { errorMessage: "Unable to update task archive right now." };
  }

  await enqueueCalendarSyncJob(
    {
      taskId: normalizedTaskId,
      ownerUserId: task.owner_user_id,
      operation: archived ? "delete" : "upsert",
    },
    { supabase, nowIso: updatedAtIso },
  );

  return { errorMessage: null };
}

export async function archiveTask(
  taskId: string,
  options?: { supabase?: SupabaseServerClient; updatedAtIso?: string },
) {
  return updateTaskArchiveState(taskId, true, options);
}

export async function unarchiveTask(
  taskId: string,
  options?: { supabase?: SupabaseServerClient; updatedAtIso?: string },
) {
  return updateTaskArchiveState(taskId, false, options);
}

export async function getTaskById(
  taskId: string,
  options?: { supabase?: SupabaseServerClient },
) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const normalizedTaskId = taskId.trim();

  if (!normalizedTaskId) {
    return {
      errorMessage: "Task id is required.",
      data: null,
    };
  }

  let { data, error } = await supabase
    .from("tasks")
    .select(
      "id, title, description, blocked_reason, status, priority, start_date, due_date, planned_for_date, scheduled_start_at, scheduled_end_at, calendar_sync_enabled, calendar_reminder_minutes, estimate_minutes, updated_at, completed_at, project_id, goal_id, focus_rank, board_rank, archived_at, archived_by, projects(name, slug), goals(title)",
    )
    .eq("id", normalizedTaskId)
    .maybeSingle();

  if (error && isTasksBlockedReasonMissing(error)) {
    const fallbackResult = await supabase
      .from("tasks")
      .select(
        "id, title, description, status, priority, start_date, due_date, planned_for_date, scheduled_start_at, scheduled_end_at, calendar_sync_enabled, calendar_reminder_minutes, estimate_minutes, updated_at, completed_at, project_id, goal_id, focus_rank, board_rank, archived_at, archived_by, projects(name, slug), goals(title)",
      )
      .eq("id", normalizedTaskId)
      .maybeSingle();

    if (!fallbackResult.error) {
      data = fallbackResult.data
        ? {
            ...fallbackResult.data,
            blocked_reason: null,
            completed_at: fallbackResult.data.completed_at ?? null,
          }
        : null;
      error = null;
    }
  }

  if (error) {
    return {
      errorMessage: "Unable to load task right now.",
      data: null,
    };
  }

  if (!data) {
    return {
      errorMessage: null,
      data: null,
    };
  }

  const recurrencesByTaskId = await getTaskRecurrencesForTasks(supabase, [normalizedTaskId]);

  return {
    errorMessage: null,
    data: {
      ...data,
      task_reminders: [],
      task_recurrences: recurrencesByTaskId[normalizedTaskId] ?? [],
    } as TaskRecord,
  };
}

export async function deleteTaskSafely(
  taskId: string,
  options?: { supabase?: SupabaseServerClient },
) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const normalizedTaskId = taskId.trim();

  if (!normalizedTaskId) {
    return { errorMessage: "Task id is required." };
  }

  const taskResult = await supabase
    .from("tasks")
    .select("id, owner_user_id, calendar_event_id")
    .eq("id", normalizedTaskId)
    .maybeSingle();

  if (taskResult.error) {
    return { errorMessage: "Unable to load task right now." };
  }

  if (!taskResult.data) {
    return { errorMessage: "Task was not found or is no longer available." };
  }

  const activeSessionResult = await supabase
    .from("task_sessions")
    .select("id")
    .eq("task_id", normalizedTaskId)
    .is("ended_at", null)
    .limit(1);

  if (activeSessionResult.error) {
    return { errorMessage: "Unable to validate timer sessions for this task right now." };
  }

  if ((activeSessionResult.data ?? []).length > 0) {
    return { errorMessage: "Stop the active timer on this task before deleting it." };
  }

  const sessionCountResult = await supabase
    .from("task_sessions")
    .select("id", { count: "exact", head: true })
    .eq("task_id", normalizedTaskId);

  if (sessionCountResult.error) {
    return { errorMessage: "Unable to validate task history right now." };
  }

  if ((sessionCountResult.count ?? 0) > 0) {
    return { errorMessage: "Task has tracked timer history and cannot be deleted safely." };
  }

  const calendarEventId = taskResult.data.calendar_event_id;
  const ownerUserId = taskResult.data.owner_user_id;

  const { error: deleteError } = await supabase
    .from("tasks")
    .delete()
    .eq("id", normalizedTaskId);

  if (deleteError) {
    return { errorMessage: "Unable to delete task right now." };
  }

  if (calendarEventId) {
    await enqueueCalendarSyncJob(
      {
        taskId: normalizedTaskId,
        ownerUserId,
        calendarEventId,
        operation: "delete",
      },
      { supabase },
    );
  }

  return { errorMessage: null };
}

/**
 * Minimal projection the task drawer needs for its header and read-only
 * metadata. Mutations keep using the existing validated update services.
 */
export type TaskDrawerDetail = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  start_date: string | null;
  due_date: string | null;
  estimate_minutes: number | null;
  blocked_reason: string | null;
  project_id: string | null;
  goal_id: string | null;
  archived_at: string | null;
  /** Blocked-by dependency detail, loaded with the drawer row. */
  dependencies: TaskDependencyDetail | null;
  dependencyError: string | null;
};

/**
 * Load one task for the detail drawer, scoped to the authenticated owner.
 *
 * RLS already restricts rows to the caller; the explicit `owner_user_id` filter
 * makes the intent local and keeps an unknown id indistinguishable from another
 * owner's id (both `unavailable`), so the drawer cannot disclose that a task
 * exists elsewhere. A query error is reported as `error`, never as a missing
 * task.
 */
export type TaskDrawerDetailResult =
  | { kind: "found"; task: TaskDrawerDetail }
  | { kind: "unavailable" }
  | { kind: "error" };

export async function getTaskDrawerDetail(
  taskId: string,
  options?: { supabase?: SupabaseServerClient },
): Promise<TaskDrawerDetailResult> {
  const normalizedId = taskId.trim();
  if (!normalizedId) return { kind: "unavailable" };

  const supabase = await resolveSupabaseClient(options?.supabase);
  const userId = await getAuthenticatedUserId(supabase);
  if (!userId) return { kind: "unavailable" };

  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, title, description, status, priority, start_date, due_date, estimate_minutes, blocked_reason, project_id, goal_id, archived_at",
    )
    .eq("id", normalizedId)
    .eq("owner_user_id", userId)
    .maybeSingle();

  // A missing row (unknown id or another owner's task under RLS) is
  // indistinguishable; a query error is an operational failure and must not be
  // reported to the user as "deleted".
  if (error) return { kind: "error" };
  if (!data) return { kind: "unavailable" };

  const dependencyResult = await getTaskDependencyDetail(normalizedId, { supabase });

  return {
    kind: "found",
    task: {
      ...(data as Omit<TaskDrawerDetail, "dependencies" | "dependencyError">),
      dependencies: dependencyResult.data,
      dependencyError: dependencyResult.errorMessage,
    },
  };
}

/**
 * Fields the drawer may patch one at a time.
 *
 * Deliberately narrow: project/goal, recurrence, reminders and scheduling keep
 * their dedicated services because they carry side effects a generic patch must
 * not bypass.
 */
export const TASK_FIELD_PATCH_FIELDS = [
  "title",
  "description",
  "status",
  "priority",
  "project",
  "startDate",
  "dueDate",
  "plannedDate",
  "estimateMinutes",
  "blockedReason",
] as const;

export type TaskFieldPatchField = (typeof TASK_FIELD_PATCH_FIELDS)[number];

export function isTaskFieldPatchField(value: string): value is TaskFieldPatchField {
  return (TASK_FIELD_PATCH_FIELDS as readonly string[]).includes(value);
}

/** The current values a single-field patch must carry forward unchanged. */
export type TaskFieldPatchCurrent = {
  title: string;
  description: string | null;
  status: string;
  priority: string;
  project_id: string;
  start_date: string | null;
  due_date: string | null;
  planned_for_date: string | null;
  estimate_minutes: number | null;
  blocked_reason: string | null;
};

/**
 * Merge one changed field into the task's current values.
 *
 * `validateTaskInlineUpdateInput` requires status/priority/due/estimate/blocked
 * together, so a single-field patch cannot forward only the changed field. The
 * current values come from the server-side row, never from hidden client fields,
 * so an unrelated stale field can never be written back.
 */
export function buildTaskFieldPatchInput(
  taskId: string,
  current: TaskFieldPatchCurrent,
  field: string,
  value: string,
): { errorMessage: null; input: ValidateTaskInlineUpdateInput } | { errorMessage: string } {
  if (!isTaskFieldPatchField(field)) {
    return { errorMessage: "Unsupported task field update." };
  }

  const input: ValidateTaskInlineUpdateInput = {
    taskId,
    // Carried only when the patch targets it: `updateTaskInline` rewrites every
    // field it receives, and a priority/due edit must not touch the title.
    title: field === "title" ? value : undefined,
    // Same rule as the title: only a description edit carries a description, so
    // a status/priority patch can never overwrite text the drawer did not show.
    description: field === "description" ? value : undefined,
    status: current.status,
    priority: current.priority,
    startDate: current.start_date ?? "",
    dueDate: current.due_date ?? "",
    // Carried only for a planned-date patch: `updateTaskInline` writes every
    // field it receives, so unrelated patches must leave the date untouched.
    plannedForDate: field === "plannedDate" ? value : undefined,
    estimateMinutes: current.estimate_minutes,
    blockedReason: current.blocked_reason,
  };

  if (field === "status") input.status = value;
  if (field === "priority") input.priority = value;
  if (field === "project") {
    input.projectId = value;
    // The goal must belong to the selected project. Match the bulk path by
    // clearing it only when the project actually changes.
    if (value !== current.project_id) input.goalId = "";
  }
  if (field === "startDate") input.startDate = value;
  if (field === "dueDate") input.dueDate = value;
  if (field === "plannedDate") input.plannedForDate = value;
  if (field === "estimateMinutes") input.estimateMinutes = value;
  if (field === "blockedReason") input.blockedReason = value;

  return { errorMessage: null, input };
}

/**
 * Move/resize a planned task bar: both date-only endpoints in one versioned
 * write.
 *
 * Timeline drag/resize and the non-drag date editor share this function, so
 * they enforce the same date-only validation, `due >= start`, owner scope and
 * optimistic version check. Routing through `updateTaskInline` also preserves
 * the existing calendar-signal policy and unrelated task fields.
 */
export async function updateTaskTimelineSchedule(
  input: {
    taskId: string;
    startDate: unknown;
    dueDate: unknown;
    expectedUpdatedAt?: string;
  },
  options?: { supabase?: SupabaseServerClient; accountTimezone?: string },
): Promise<{ errorMessage: string | null }> {
  const taskId = input.taskId.trim();
  if (!taskId) return { errorMessage: "Task schedule update request is invalid." };

  const startDateResult = normalizeTaskStartDateInput(input.startDate);
  const dueDateResult = normalizeTaskDueDateInput(input.dueDate);
  if (startDateResult.error) return { errorMessage: startDateResult.error };
  if (dueDateResult.error) return { errorMessage: dueDateResult.error };
  if (startDateResult.value && dueDateResult.value && dueDateResult.value < startDateResult.value) {
    return { errorMessage: "Due date cannot be before the start date." };
  }

  const supabase = await resolveSupabaseClient(options?.supabase);
  const userId = await getAuthenticatedUserId(supabase);
  if (!userId) return { errorMessage: "Task was not found or is no longer available." };

  const { data: current, error: loadError } = await supabase
    .from("tasks")
    .select("status, priority, start_date, due_date, estimate_minutes, blocked_reason, archived_at, updated_at")
    .eq("id", taskId)
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (loadError) return { errorMessage: "Unable to load task right now." };
  if (!current) return { errorMessage: "Task was not found or is no longer available." };
  if (current.archived_at) return { errorMessage: "Restore this task before changing its dates." };

  const expectedUpdatedAt = String(input.expectedUpdatedAt ?? "").trim() || current.updated_at;
  if (expectedUpdatedAt !== current.updated_at) {
    return { errorMessage: "This task changed since you opened it. Reload and try again." };
  }

  const validation = validateTaskInlineUpdateInput({
    taskId,
    status: String(current.status),
    priority: String(current.priority),
    startDate: startDateResult.value,
    dueDate: dueDateResult.value,
    estimateMinutes: current.estimate_minutes,
    blockedReason: current.blocked_reason,
    accountTimezone: options?.accountTimezone,
  });
  if (validation.errorMessage || !validation.data) {
    return { errorMessage: validation.errorMessage ?? "Task schedule update is invalid." };
  }

  return updateTaskInline(validation.data, {
    supabase,
    expectedUpdatedAt: current.updated_at,
  });
}

export type TaskFieldPatchResult = {
  errorMessage: string | null;
  savedValue?: string;
  updatedAt?: string;
};

/**
 * Apply one whitelisted field change to a task the caller owns.
 *
 * The current row is read server-side and merged into the validated input, so a
 * single-field patch can never write back a stale value the browser happened to
 * hold. Unknown ids, another owner's ids and a missing session all return the
 * same message.
 *
 * When the caller supplies `expectedUpdatedAt` (the revision it rendered), a
 * changed row is rejected before any write. The write itself is always guarded
 * by the revision read here.
 */
export async function updateTaskFieldForOwner(
  input: {
    taskId: string;
    field: string;
    value: string;
    expectedUpdatedAt?: string;
  },
  options?: {
    supabase?: SupabaseServerClient;
    accountTimezone?: string;
    fallbackAnchorDate?: string;
    /**
     * Revision the calendar rendered. A newer edit rejects the write instead
     * of silently overwriting it.
     */
    expectedUpdatedAt?: string;
  },
): Promise<TaskFieldPatchResult> {
  const taskId = input.taskId.trim();
  if (!taskId) return { errorMessage: "Task update request is invalid." };
  if (!isTaskFieldPatchField(input.field)) {
    return { errorMessage: "Unsupported task field update." };
  }

  const supabase = await resolveSupabaseClient(options?.supabase);
  const userId = await getAuthenticatedUserId(supabase);
  if (!userId) return { errorMessage: "Task was not found or is no longer available." };

  const { data: current, error: loadError } = await supabase
    .from("tasks")
    .select(
      "title, description, status, priority, project_id, start_date, due_date, planned_for_date, scheduled_start_at, scheduled_end_at, calendar_sync_enabled, estimate_minutes, blocked_reason, updated_at",
    )
    .eq("id", taskId)
    .eq("owner_user_id", userId)
    .maybeSingle();

  if (loadError) return { errorMessage: "Unable to load task right now." };
  if (!current) {
    return { errorMessage: "Task was not found or is no longer available." };
  }

  const currentUpdatedAt = String((current as { updated_at?: string }).updated_at ?? "");
  const expectedUpdatedAt = String(input.expectedUpdatedAt ?? "").trim();
  if (expectedUpdatedAt) {
    const expectedTime = Date.parse(expectedUpdatedAt);
    const currentTime = Date.parse(currentUpdatedAt);
    const matches =
      Number.isFinite(expectedTime) && Number.isFinite(currentTime)
        ? expectedTime === currentTime
        : expectedUpdatedAt === currentUpdatedAt;
    if (!matches) {
      return {
        errorMessage: "This task changed since you opened it. Reload and try again.",
      };
    }
  }

  const built = buildTaskFieldPatchInput(
    taskId,
    current as TaskFieldPatchCurrent,
    input.field,
    input.value,
  );
  if (!("input" in built)) return { errorMessage: built.errorMessage };

  const validation = validateTaskInlineUpdateInput({
    ...built.input,
    accountTimezone: options?.accountTimezone,
  });
  if (validation.errorMessage || !validation.data) {
    return { errorMessage: validation.errorMessage ?? "Task update request is invalid." };
  }

  const updatedAtIso = new Date().toISOString();
  const result = await updateTaskInline(validation.data, {
    supabase,
    updatedAtIso,
    fallbackAnchorDate: options?.fallbackAnchorDate,
    expectedUpdatedAt: currentUpdatedAt,
  });

  if (result.errorMessage) return { errorMessage: result.errorMessage };

  // A due/planned move changes only the selected date field, but an already
  // scheduled task with calendar sync enabled must still re-push its event so
  // external calendar copies agree with the task surface.
  if (input.field === "dueDate" || input.field === "plannedDate") {
    const scheduledStartAt = (current as { scheduled_start_at?: string | null }).scheduled_start_at;
    const scheduledEndAt = (current as { scheduled_end_at?: string | null }).scheduled_end_at;
    const calendarSyncEnabled = Boolean(
      (current as { calendar_sync_enabled?: boolean | null }).calendar_sync_enabled,
    );
    if (calendarSyncEnabled && scheduledStartAt && scheduledEndAt) {
      await enqueueCalendarSyncJob(
        { taskId, ownerUserId: userId, operation: "upsert" },
        { supabase },
      );
    }
  }

  return {
    errorMessage: null,
    savedValue: input.value,
    updatedAt: updatedAtIso,
  };
}

// ---------------------------------------------------------------------------
// Calendar rescheduling
// ---------------------------------------------------------------------------

export type TaskCalendarDateMoveField = "due" | "planned";

export type TaskCalendarRescheduleResult = {
  errorMessage: string | null;
  /** False for an idempotent duplicate submit that matched the stored value. */
  changed: boolean;
};

const TASK_CALENDAR_MOVE_SELECT =
  "id, title, description, status, priority, due_date, planned_for_date, scheduled_start_at, scheduled_end_at, calendar_sync_enabled, estimate_minutes, blocked_reason, updated_at";

function padCalendarPart(value: number) {
  return String(value).padStart(2, "0");
}

function formatUtcWallDate(valueMs: number) {
  const date = new Date(valueMs);
  return `${date.getUTCFullYear()}-${padCalendarPart(date.getUTCMonth() + 1)}-${padCalendarPart(
    date.getUTCDate(),
  )}T${padCalendarPart(date.getUTCHours())}:${padCalendarPart(date.getUTCMinutes())}`;
}

/**
 * Preserve the block's wall-clock duration while moving it to another local
 * date/time. The returned values are `datetime-local` strings interpreted in
 * the owner's timezone by the canonical schedule validator.
 */
export function buildRescheduledWallWindow(input: {
  currentStartIso: string;
  currentEndIso: string;
  timezone: string;
  targetDate: string;
  targetTime?: string | null;
}): { errorMessage: null; startLocal: string; endLocal: string } | { errorMessage: string } {
  if (!isDateOnlyValue(input.targetDate)) {
    return { errorMessage: "Choose a valid day to move this block." };
  }

  const currentStart = getLocalWallTimeParts(input.currentStartIso, input.timezone);
  const currentEnd = getLocalWallTimeParts(input.currentEndIso, input.timezone);
  if (!currentStart || !currentEnd) {
    return { errorMessage: "Unable to read the scheduled block right now." };
  }

  const targetTime = (input.targetTime ?? "").trim() || currentStart.time;
  if (!/^\d{2}:\d{2}$/.test(targetTime)) {
    return { errorMessage: "Start time must use HH:MM." };
  }

  const startCarrierMs = Date.parse(`${currentStart.date}T${currentStart.time}:00.000Z`);
  const endCarrierMs = Date.parse(`${currentEnd.date}T${currentEnd.time}:00.000Z`);
  const durationMinutes = Math.round((endCarrierMs - startCarrierMs) / 60_000);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return { errorMessage: "The scheduled block is invalid." };
  }

  const targetStartMs = Date.parse(`${input.targetDate}T${targetTime}:00.000Z`);
  if (!Number.isFinite(targetStartMs)) {
    return { errorMessage: "Choose a valid day and time to move this block." };
  }

  return {
    errorMessage: null,
    startLocal: `${input.targetDate}T${targetTime}`,
    endLocal: formatUtcWallDate(targetStartMs + durationMinutes * 60_000),
  };
}

type CalendarMoveTaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  planned_for_date: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  calendar_sync_enabled: boolean;
  estimate_minutes: number | null;
  blocked_reason: string | null;
  updated_at: string;
};

async function loadCalendarMoveTask(
  supabase: SupabaseServerClient,
  userId: string,
  taskId: string,
): Promise<{ task: CalendarMoveTaskRow | null; errorMessage: string | null }> {
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_CALENDAR_MOVE_SELECT)
    .eq("id", taskId)
    .eq("owner_user_id", userId)
    .maybeSingle();

  if (error) return { task: null, errorMessage: "Unable to load task right now." };
  if (!data) {
    return { task: null, errorMessage: "Task was not found or is no longer available." };
  }
  return { task: data as CalendarMoveTaskRow, errorMessage: null };
}

/**
 * Move a task between calendar days by changing only the selected date field.
 *
 * The current row is read server-side, so the action never trusts a client
 * snapshot for unrelated fields. A duplicate submit that already matches the
 * stored date is a successful no-op; a stale render is rejected.
 */
export async function rescheduleTaskDateForOwner(
  input: {
    taskId: string;
    field: TaskCalendarDateMoveField;
    date: string;
    expectedUpdatedAt?: string;
  },
  options?: {
    supabase?: SupabaseServerClient;
    accountTimezone?: string;
    fallbackAnchorDate?: string;
  },
): Promise<TaskCalendarRescheduleResult> {
  const taskId = input.taskId.trim();
  if (!taskId) {
    return { errorMessage: "Task update request is invalid.", changed: false };
  }
  if (input.field !== "due" && input.field !== "planned") {
    return { errorMessage: "Unsupported calendar date field.", changed: false };
  }

  const normalizedDate =
    input.field === "planned"
      ? normalizeTaskPlannedDateInput(input.date)
      : normalizeTaskDueDateInput(input.date);
  if (normalizedDate.error || !normalizedDate.value) {
    return {
      errorMessage: normalizedDate.error ?? "Choose a valid day to move this task.",
      changed: false,
    };
  }

  const supabase = await resolveSupabaseClient(options?.supabase);
  const userId = await getAuthenticatedUserId(supabase);
  if (!userId) {
    return { errorMessage: "Task was not found or is no longer available.", changed: false };
  }

  const loaded = await loadCalendarMoveTask(supabase, userId, taskId);
  if (!loaded.task) {
    return { errorMessage: loaded.errorMessage, changed: false };
  }

  const currentValue =
    input.field === "planned" ? loaded.task.planned_for_date : loaded.task.due_date;
  if (currentValue === normalizedDate.value) {
    return { errorMessage: null, changed: false };
  }

  if (input.expectedUpdatedAt && input.expectedUpdatedAt !== loaded.task.updated_at) {
    return {
      errorMessage: "This task changed since you opened it. Reload and try again.",
      changed: false,
    };
  }

  const result = await updateTaskFieldForOwner(
    {
      taskId,
      field: input.field === "planned" ? "plannedDate" : "dueDate",
      value: normalizedDate.value,
      expectedUpdatedAt: input.expectedUpdatedAt ?? loaded.task.updated_at,
    },
    {
      supabase,
      accountTimezone: options?.accountTimezone,
      fallbackAnchorDate: options?.fallbackAnchorDate,
    },
  );

  return { errorMessage: result.errorMessage, changed: result.errorMessage === null };
}

/**
 * Move a scheduled block to another local day (and optionally start time),
 * preserving its wall-clock duration. Validation and the write go through the
 * canonical schedule input, so DST gaps, owner timezone and calendar resync
 * behave exactly like the task editor.
 */
export async function rescheduleTaskScheduledWindowForOwner(
  input: {
    taskId: string;
    date: string;
    time?: string | null;
    expectedUpdatedAt?: string;
  },
  options?: {
    supabase?: SupabaseServerClient;
    accountTimezone?: string;
    fallbackAnchorDate?: string;
  },
): Promise<TaskCalendarRescheduleResult> {
  const taskId = input.taskId.trim();
  if (!taskId) {
    return { errorMessage: "Task update request is invalid.", changed: false };
  }

  const timezone = options?.accountTimezone?.trim();
  if (!timezone) {
    return {
      errorMessage: "Unable to load the account timezone right now.",
      changed: false,
    };
  }

  const supabase = await resolveSupabaseClient(options?.supabase);
  const userId = await getAuthenticatedUserId(supabase);
  if (!userId) {
    return { errorMessage: "Task was not found or is no longer available.", changed: false };
  }

  const loaded = await loadCalendarMoveTask(supabase, userId, taskId);
  if (!loaded.task) {
    return { errorMessage: loaded.errorMessage, changed: false };
  }

  if (!loaded.task.scheduled_start_at || !loaded.task.scheduled_end_at) {
    return { errorMessage: "This task has no scheduled block to move.", changed: false };
  }

  const wallWindow = buildRescheduledWallWindow({
    currentStartIso: loaded.task.scheduled_start_at,
    currentEndIso: loaded.task.scheduled_end_at,
    timezone,
    targetDate: input.date,
    targetTime: input.time,
  });
  if (!("startLocal" in wallWindow)) {
    return { errorMessage: wallWindow.errorMessage, changed: false };
  }

  const currentStart = getLocalWallTimeParts(loaded.task.scheduled_start_at, timezone);
  if (
    currentStart &&
    currentStart.date === input.date &&
    wallWindow.startLocal === `${currentStart.date}T${currentStart.time}`
  ) {
    return { errorMessage: null, changed: false };
  }

  if (input.expectedUpdatedAt && input.expectedUpdatedAt !== loaded.task.updated_at) {
    return {
      errorMessage: "This task changed since you opened it. Reload and try again.",
      changed: false,
    };
  }

  const validation = validateTaskInlineUpdateInput({
    taskId,
    status: loaded.task.status,
    priority: loaded.task.priority,
    dueDate: loaded.task.due_date ?? "",
    plannedForDate: loaded.task.planned_for_date,
    estimateMinutes: loaded.task.estimate_minutes,
    blockedReason: loaded.task.blocked_reason,
    scheduledStartAt: wallWindow.startLocal,
    scheduledEndAt: wallWindow.endLocal,
    accountTimezone: timezone,
    fallbackAnchorDate: options?.fallbackAnchorDate,
  });
  if (validation.errorMessage || !validation.data) {
    return {
      errorMessage: validation.errorMessage ?? "Scheduled block is invalid.",
      changed: false,
    };
  }

  const result = await updateTaskInline(validation.data, {
    supabase,
    expectedUpdatedAt: input.expectedUpdatedAt ?? loaded.task.updated_at,
    fallbackAnchorDate: options?.fallbackAnchorDate,
  });

  return { errorMessage: result.errorMessage, changed: result.errorMessage === null };
}
}

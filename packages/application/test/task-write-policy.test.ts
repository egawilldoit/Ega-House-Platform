import assert from "node:assert/strict";
import test from "node:test";

import { TASK_TITLE_LENGTH_ERROR } from "@ega/domain";

import {
  TASK_FIELD_PATCH_FIELDS,
  buildRescheduledWallWindow,
  buildTaskFieldPatchInput,
  getTaskInsertScopeError,
  isTaskFieldPatchField,
  normalizeTaskBlockedReasonInput,
  normalizeTaskReminderCancelInput,
  normalizeTaskReminderCreateInput,
  validateTaskInlineUpdateInput,
  type TaskScopeSnapshot,
} from "../src/index";

const VALID_INLINE_INPUT = {
  taskId: "task-1",
  status: "todo",
  priority: "medium",
  dueDate: "",
  estimateMinutes: "",
  blockedReason: "",
} as const;

test("blocked reason normalization trims text and empties null", () => {
  assert.equal(normalizeTaskBlockedReasonInput(" waiting on vendor API "), "waiting on vendor API");
  assert.equal(normalizeTaskBlockedReasonInput(""), null);
  assert.equal(normalizeTaskBlockedReasonInput(null), null);
});

test("inline update requires a blocked reason only for blocked status", () => {
  const blocked = validateTaskInlineUpdateInput({
    ...VALID_INLINE_INPUT,
    status: "blocked",
    blockedReason: "   ",
  });
  assert.equal(blocked.errorMessage, "Blocked reason is required when status is Blocked.");

  const todo = validateTaskInlineUpdateInput({
    ...VALID_INLINE_INPUT,
    blockedReason: "stale reason",
  });
  assert.equal(todo.errorMessage, null);
  assert.equal(todo.data?.blockedReason, null);

  const withReason = validateTaskInlineUpdateInput({
    ...VALID_INLINE_INPUT,
    status: "blocked",
    blockedReason: " waiting on infra ",
  });
  assert.equal(withReason.errorMessage, null);
  assert.equal(withReason.data?.blockedReason, "waiting on infra");
});

test("inline update trims identity fields and rejects empty identity", () => {
  const normalized = validateTaskInlineUpdateInput({
    ...VALID_INLINE_INPUT,
    title: "  Updated title  ",
    projectId: " project-2 ",
    goalId: " goal-2 ",
    description: "  Updated context  ",
  });
  assert.equal(normalized.errorMessage, null);
  assert.equal(normalized.data?.title, "Updated title");
  assert.equal(normalized.data?.projectId, "project-2");
  assert.equal(normalized.data?.goalId, "goal-2");
  assert.equal(normalized.data?.description, "Updated context");

  assert.equal(
    validateTaskInlineUpdateInput({ ...VALID_INLINE_INPUT, title: "   " }).errorMessage,
    "Task title is required.",
  );
  assert.equal(
    validateTaskInlineUpdateInput({ ...VALID_INLINE_INPUT, projectId: "   " }).errorMessage,
    "Project is required.",
  );
  assert.equal(validateTaskInlineUpdateInput({ ...VALID_INLINE_INPUT, taskId: " " }).errorMessage, "Task update request is invalid.");
});

test("inline update enforces the shared title limit", () => {
  const tooLong = validateTaskInlineUpdateInput({
    ...VALID_INLINE_INPUT,
    title: "x".repeat(257),
  });
  assert.equal(tooLong.errorMessage, TASK_TITLE_LENGTH_ERROR);

  const atLimit = validateTaskInlineUpdateInput({
    ...VALID_INLINE_INPUT,
    title: "x".repeat(256),
  });
  assert.equal(atLimit.errorMessage, null);
});

test("inline update validates status, priority and dates", () => {
  assert.match(
    validateTaskInlineUpdateInput({ ...VALID_INLINE_INPUT, status: "nope" }).errorMessage ?? "",
    /^Status must be one of:/,
  );
  assert.match(
    validateTaskInlineUpdateInput({ ...VALID_INLINE_INPUT, priority: "nope" }).errorMessage ?? "",
    /^Priority must be one of:/,
  );
  assert.equal(
    validateTaskInlineUpdateInput({ ...VALID_INLINE_INPUT, dueDate: "2026-02-30" }).errorMessage,
    "Due date must be a valid date in YYYY-MM-DD format.",
  );
  assert.equal(
    validateTaskInlineUpdateInput({
      ...VALID_INLINE_INPUT,
      startDate: "2026-05-10",
      dueDate: "2026-05-09",
    }).errorMessage,
    "Due date cannot be before the start date.",
  );
});

test("inline update validates estimates and schedules", () => {
  assert.equal(
    validateTaskInlineUpdateInput({ ...VALID_INLINE_INPUT, estimateMinutes: "1.5" }).errorMessage,
    "Estimate must be a whole number of minutes.",
  );
  assert.equal(
    validateTaskInlineUpdateInput({
      ...VALID_INLINE_INPUT,
      scheduledStartAt: "2026-05-09T10:00",
      scheduledEndAt: "2026-05-09T09:59",
      accountTimezone: "UTC",
    }).errorMessage,
    "Scheduled end must be after scheduled start.",
  );
  const validSchedule = validateTaskInlineUpdateInput({
    ...VALID_INLINE_INPUT,
    scheduledStartAt: "2026-05-09T09:00",
    scheduledEndAt: "2026-05-09T10:00",
    accountTimezone: "UTC",
  });
  assert.equal(validSchedule.errorMessage, null);
  assert.equal(validSchedule.data?.scheduledStartAt, "2026-05-09T09:00:00.000Z");
  assert.equal(validSchedule.data?.scheduledEndAt, "2026-05-09T10:00:00.000Z");
});

test("inline update normalizes calendar sync fields without requiring sync", () => {
  const result = validateTaskInlineUpdateInput({
    ...VALID_INLINE_INPUT,
    calendarReminderMinutes: "30",
  });
  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.calendarSyncEnabled, false);
  assert.equal(result.data?.calendarReminderMinutes, 30);
});

test("inline update anchors recurrence on the submitted due date or the account day", () => {
  const fromDueDate = validateTaskInlineUpdateInput({
    ...VALID_INLINE_INPUT,
    dueDate: "2026-05-09",
    recurrenceRule: "daily",
    recurrenceTimezone: "UTC",
  });
  assert.equal(fromDueDate.errorMessage, null);
  assert.equal(fromDueDate.data?.recurrenceAnchorDate, "2026-05-09");

  const fromAccountDay = validateTaskInlineUpdateInput({
    ...VALID_INLINE_INPUT,
    recurrenceRule: "daily",
    recurrenceTimezone: "UTC",
    accountTimezone: "UTC",
    fallbackAnchorDate: "2026-05-11",
  });
  assert.equal(fromAccountDay.errorMessage, null);
  assert.equal(fromAccountDay.data?.recurrenceAnchorDate, "2026-05-11");
});

test("field patch list is closed and documented", () => {
  assert.deepEqual([...TASK_FIELD_PATCH_FIELDS], [
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
  ]);
  assert.equal(isTaskFieldPatchField("status"), true);
  assert.equal(isTaskFieldPatchField("owner_user_id"), false);
});

const FIELD_PATCH_CURRENT = {
  title: "Original",
  description: "Body",
  status: "todo",
  priority: "medium",
  project_id: "project-1",
  start_date: null,
  due_date: "2026-05-10",
  planned_for_date: "2026-05-10",
  estimate_minutes: 30,
  blocked_reason: null,
} as const;

test("field patch carries only the changed field and canonical current values", () => {
  const status = buildTaskFieldPatchInput("task-1", FIELD_PATCH_CURRENT, "status", "blocked");
  assert.equal("input" in status, true);
  if (!("input" in status)) return;
  assert.equal(status.input.status, "blocked");
  assert.equal(status.input.title, undefined);
  assert.equal(status.input.description, undefined);
  assert.equal(status.input.dueDate, "2026-05-10");
  assert.equal(status.input.estimateMinutes, 30);

  const title = buildTaskFieldPatchInput("task-1", FIELD_PATCH_CURRENT, "title", "Renamed");
  assert.equal("input" in title, true);
  if (!("input" in title)) return;
  assert.equal(title.input.title, "Renamed");
});

test("field patch clears the goal only when the project actually changes", () => {
  const changing = buildTaskFieldPatchInput("task-1", FIELD_PATCH_CURRENT, "project", "project-2");
  assert.equal("input" in changing, true);
  if (!("input" in changing)) return;
  assert.equal(changing.input.projectId, "project-2");
  assert.equal(changing.input.goalId, "");

  const same = buildTaskFieldPatchInput("task-1", FIELD_PATCH_CURRENT, "project", "project-1");
  assert.equal("input" in same, true);
  if (!("input" in same)) return;
  assert.equal(same.input.goalId, undefined);
});

test("field patch rejects unknown fields", () => {
  assert.deepEqual(buildTaskFieldPatchInput("task-1", FIELD_PATCH_CURRENT, "owner", "x"), {
    errorMessage: "Unsupported task field update.",
  });
});

test("scope rejects unknown project, unknown goal and cross-project goal", () => {
  const scope: TaskScopeSnapshot = {
    projectIds: new Set(["project-1"]),
    goalsById: new Map([["goal-1", { id: "goal-1", project_id: "project-1" }]]),
  };

  assert.equal(
    getTaskInsertScopeError({ project_id: "project-missing", goal_id: null }, scope),
    "Selected project is unavailable.",
  );
  assert.equal(
    getTaskInsertScopeError({ project_id: "project-1", goal_id: "goal-missing" }, scope),
    "Selected goal is unavailable.",
  );
  assert.equal(
    getTaskInsertScopeError({ project_id: "project-1", goal_id: "goal-1" }, scope),
    null,
  );
});

test("rescheduled wall window preserves the wall-clock duration", () => {
  const window = buildRescheduledWallWindow({
    currentStartIso: "2026-05-09T14:00:00.000Z",
    currentEndIso: "2026-05-09T15:30:00.000Z",
    timezone: "UTC",
    targetDate: "2026-05-12",
  });
  assert.deepEqual(window, {
    errorMessage: null,
    startLocal: "2026-05-12T14:00",
    endLocal: "2026-05-12T15:30",
  });

  const withTime = buildRescheduledWallWindow({
    currentStartIso: "2026-05-09T14:00:00.000Z",
    currentEndIso: "2026-05-09T15:30:00.000Z",
    timezone: "UTC",
    targetDate: "2026-05-12",
    targetTime: "09:15",
  });
  assert.deepEqual(withTime, {
    errorMessage: null,
    startLocal: "2026-05-12T09:15",
    endLocal: "2026-05-12T10:45",
  });
});

test("rescheduled wall window rejects invalid input", () => {
  assert.deepEqual(
    buildRescheduledWallWindow({
      currentStartIso: "2026-05-09T14:00:00.000Z",
      currentEndIso: "2026-05-09T15:30:00.000Z",
      timezone: "UTC",
      targetDate: "2026-02-30",
    }),
    { errorMessage: "Choose a valid day to move this block." },
  );
  assert.deepEqual(
    buildRescheduledWallWindow({
      currentStartIso: "2026-05-09T14:00:00.000Z",
      currentEndIso: "2026-05-09T15:30:00.000Z",
      timezone: "UTC",
      targetDate: "2026-05-12",
      targetTime: "9:15",
    }),
    { errorMessage: "Start time must use HH:MM." },
  );
});

test("reminder create converts wall time in the account timezone", () => {
  const result = normalizeTaskReminderCreateInput({
    taskId: " task-1 ",
    remindAt: "2026-05-09T09:30",
    timezone: "Africa/Lagos",
    now: new Date("2026-05-01T00:00:00.000Z"),
  });
  assert.equal(result.errorMessage, null);
  if (!("data" in result) || !result.data) return;
  assert.equal(result.data.taskId, "task-1");
  assert.equal(result.data.remindAtIso, "2026-05-09T08:30:00.000Z");
  assert.equal(result.data.channel, "email");
  assert.equal(result.data.status, "pending");
});

test("reminder create rejects past times, unsupported channel/status and bad timezone", () => {
  assert.equal(
    normalizeTaskReminderCreateInput({
      taskId: "task-1",
      remindAt: "2026-05-01T09:00:00.000Z",
      now: new Date("2026-05-01T10:00:00.000Z"),
    }).errorMessage,
    "Reminder time must be in the future.",
  );
  assert.equal(
    normalizeTaskReminderCreateInput({
      taskId: "task-1",
      remindAt: "2026-05-09T09:30:00.000Z",
      channel: "push",
      now: new Date("2026-05-01T00:00:00.000Z"),
    }).errorMessage,
    "Reminder channel is not supported.",
  );
  assert.equal(
    normalizeTaskReminderCreateInput({
      taskId: "task-1",
      remindAt: "2026-05-09T09:30:00.000Z",
      status: "sent",
      now: new Date("2026-05-01T00:00:00.000Z"),
    }).errorMessage,
    "Reminder status is not supported.",
  );
  assert.equal(
    normalizeTaskReminderCreateInput({
      taskId: "task-1",
      remindAt: "2026-05-09T09:30",
      timezone: "Mars/Olympus",
      now: new Date("2026-05-01T00:00:00.000Z"),
    }).errorMessage,
    "Reminder time is invalid for the account timezone.",
  );
});

test("reminder cancel only accepts the cancelled transition", () => {
  const cancelled = normalizeTaskReminderCancelInput({
    taskId: "task-1",
    reminderId: "reminder-1",
  });
  assert.equal(cancelled.errorMessage, null);
  if (!("data" in cancelled) || !cancelled.data) return;
  assert.equal(cancelled.data.status, "cancelled");

  assert.equal(
    normalizeTaskReminderCancelInput({ taskId: "", reminderId: "reminder-1" }).errorMessage,
    "Reminder cancel request is invalid.",
  );
  assert.equal(
    normalizeTaskReminderCancelInput({
      taskId: "task-1",
      reminderId: "reminder-1",
      status: "sent",
    }).errorMessage,
    "Reminder status is not supported.",
  );
});

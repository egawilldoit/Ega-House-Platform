import type { MobileTaskListResponse, MobileTaskMutationResponse } from "@ega/contracts/mobile";

/**
 * Shared parity fixtures for the canonical Tasks cutover.
 *
 * These literals describe exactly what the legacy `/api/mobile/tasks*`
 * surface returned (phase-1 Task 3 enriched payload) so the canonical Hono
 * endpoints can be proven shape-for-shape equivalent. Server-local "today"
 * is fixed at 2026-08-10 through the app clock dependency.
 */

export const PARITY_TODAY = "2026-08-10";

export type ParityTaskRow = Record<string, unknown>;

function baseRow(overrides: Record<string, unknown>): ParityTaskRow {
  return {
    description: null,
    blocked_reason: null,
    estimate_minutes: null,
    goal_id: null,
    planned_for_date: null,
    scheduled_start_at: null,
    scheduled_end_at: null,
    calendar_sync_enabled: false,
    calendar_reminder_minutes: 10,
    completed_at: null,
    archived_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    projects: { name: "Platform", slug: "platform" },
    goals: null,
    ...overrides,
  };
}

/** Five tasks covering every status/priority/due-bucket combination. */
export function parityTaskRows(): ParityTaskRow[] {
  return [
    baseRow({
      id: "t-overdue",
      title: "Overdue urgent",
      status: "todo",
      priority: "urgent",
      due_date: "2026-08-01",
      focus_rank: 2,
      project_id: "p1",
      goal_id: "g1",
      goals: { title: "Ship v1" },
      updated_at: "2026-08-05T00:00:00.000Z",
    }),
    baseRow({
      id: "t-today",
      title: "Due today high",
      status: "in_progress",
      priority: "high",
      due_date: PARITY_TODAY,
      focus_rank: 1,
      project_id: "p1",
      updated_at: "2026-08-09T00:00:00.000Z",
    }),
    baseRow({
      id: "t-soon",
      title: "Due soon low",
      status: "todo",
      priority: "low",
      due_date: "2026-08-14",
      project_id: "p2",
      projects: { name: "Side", slug: null },
      updated_at: "2026-08-08T00:00:00.000Z",
    }),
    baseRow({
      id: "t-nodate",
      title: "Blocked no date",
      status: "blocked",
      priority: "medium",
      blocked_reason: "Waiting on review",
      project_id: "p1",
      updated_at: "2026-08-07T00:00:00.000Z",
    }),
    baseRow({
      id: "t-done",
      title: "Completed",
      status: "done",
      priority: "low",
      due_date: "2026-08-02",
      completed_at: "2026-08-02T10:00:00.000Z",
      project_id: "p1",
      updated_at: "2026-08-04T00:00:00.000Z",
    }),
  ];
}

export function parityProjectRows() {
  return [
    { id: "p1", name: "Platform", slug: "platform" },
    { id: "p2", name: "Side", slug: null },
  ];
}

export function parityGoalRows() {
  return [
    { id: "g1", title: "Ship v1", project_id: "p1" },
    { id: "g2", title: "Side goal", project_id: "p2" },
  ];
}

export function parityReminderRows() {
  return [
    {
      id: "r1",
      task_id: "t-today",
      remind_at: "2026-08-10T09:00:00.000Z",
      channel: "email",
      status: "pending",
      sent_at: null,
      failure_reason: null,
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    },
  ];
}

export function parityRecurrenceRows() {
  return [
    {
      id: "rec1",
      task_id: "t-overdue",
      rule: "daily",
      anchor_date: "2026-08-01",
      timezone: "UTC",
      next_occurrence_date: "2026-08-11",
      last_generated_at: null,
    },
  ];
}

export function paritySessionRows() {
  return [
    { task_id: "t-today", duration_seconds: 90 },
    { task_id: "t-today", duration_seconds: 30 },
  ];
}

/** Expected enriched item for `t-overdue` under the fixture rows above. */
export function expectedOverdueItem() {
  return {
    id: "t-overdue",
    title: "Overdue urgent",
    description: null,
    blockedReason: null,
    status: "todo",
    priority: "urgent",
    dueDate: "2026-08-01",
    estimateMinutes: null,
    updatedAt: "2026-08-05T00:00:00.000Z",
    focusRank: 2,
    trackedDurationSeconds: 0,
    project: { id: "p1", name: "Platform", slug: "platform" },
    goal: { id: "g1", title: "Ship v1" },
    reminders: [],
    recurrence: {
      rule: "daily",
      anchorDate: "2026-08-01",
      timezone: "UTC",
      nextOccurrenceDate: "2026-08-11",
      lastGeneratedAt: null,
    },
  } satisfies MobileTaskMutationResponse["task"];
}

/** Expected enriched item for `t-today`, including reminder + duration embeds. */
export function expectedTodayItem() {
  return {
    id: "t-today",
    title: "Due today high",
    description: null,
    blockedReason: null,
    status: "in_progress",
    priority: "high",
    dueDate: PARITY_TODAY,
    estimateMinutes: null,
    updatedAt: "2026-08-09T00:00:00.000Z",
    focusRank: 1,
    trackedDurationSeconds: 120,
    project: { id: "p1", name: "Platform", slug: "platform" },
    goal: null,
    reminders: [
      {
        id: "r1",
        taskId: "t-today",
        remindAt: "2026-08-10T09:00:00.000Z",
        channel: "email",
        status: "pending",
        sentAt: null,
        failureReason: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    recurrence: null,
  } satisfies MobileTaskMutationResponse["task"];
}

/** Full filtered scope is five tasks; counters run BEFORE any limit slice. */
export function expectedFullCounters() {
  return {
    total: 5,
    byStatus: { todo: 2, in_progress: 1, done: 1, blocked: 1 },
    byPriority: { low: 2, medium: 1, high: 1, urgent: 1 },
    pinned: 2,
    overdue: 1,
    dueToday: 1,
  };
}

/** Expected list envelope when every fixture row comes back unfiltered. */
export function expectedListEnvelope(tasks: MobileTaskListResponse["tasks"]): MobileTaskListResponse {
  return {
    ok: true,
    tasks,
    counters: expectedFullCounters(),
    filters: {
      status: null,
      projectId: null,
      goalId: null,
      priority: null,
      due: "all",
      sort: "updated_desc",
      limit: null,
    },
    projects: [
      { id: "p1", name: "Platform", slug: "platform" },
      { id: "p2", name: "Side", slug: null },
    ],
    goals: [
      { id: "g1", title: "Ship v1" },
      { id: "g2", title: "Side goal" },
    ],
  };
}

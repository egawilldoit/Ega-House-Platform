import { describe, expect, it } from "vitest";

import type { TaskRecord } from "@/lib/services/task-service";
import {
  getMobileTaskCounters,
  mapTaskRecordToMobileTaskItem,
} from "@/app/api/mobile/_lib/helpers";

function isoDaysFromToday(days: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function makeTaskRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-1",
    title: "Ship canonical enrichment",
    description: "Describe the enrichment",
    blocked_reason: null,
    status: "todo",
    priority: "urgent",
    due_date: null,
    planned_for_date: null,
    scheduled_start_at: null,
    scheduled_end_at: null,
    calendar_sync_enabled: false,
    calendar_reminder_minutes: 10,
    estimate_minutes: 45,
    updated_at: "2026-08-22T00:00:00.000Z",
    completed_at: null,
    project_id: "project-1",
    goal_id: "goal-1",
    focus_rank: null,
    archived_at: null,
    archived_by: null,
    projects: { name: "Launch", slug: "launch" },
    goals: { title: "Ship v1" },
    task_reminders: [],
    task_recurrences: [],
    ...overrides,
  };
}

describe("mapTaskRecordToMobileTaskItem", () => {
  it("projects the canonical task onto the enriched mobile item with project slug and goal title", () => {
    const item = mapTaskRecordToMobileTaskItem(makeTaskRecord(), 90);

    expect(item).toMatchObject({
      id: "task-1",
      title: "Ship canonical enrichment",
      status: "todo",
      priority: "urgent",
      estimateMinutes: 45,
      trackedDurationSeconds: 90,
      project: { id: "project-1", name: "Launch", slug: "launch" },
      goal: { id: "goal-1", title: "Ship v1" },
    });
  });

  it("falls back to a null slug and Unknown projections when joins are missing", () => {
    const item = mapTaskRecordToMobileTaskItem(
      makeTaskRecord({ projects: null, goals: null }),
      0,
    );

    expect(item.project).toEqual({ id: "project-1", name: "Unknown project", slug: null });
    expect(item.goal).toEqual({ id: "goal-1", title: "Unknown goal" });
  });

  it("drops the goal projection entirely when the task has no goal", () => {
    const item = mapTaskRecordToMobileTaskItem(
      makeTaskRecord({ goal_id: null }),
      0,
    );

    expect(item.goal).toBeNull();
  });

  it("maps reminders and recurrence metadata", () => {
    const item = mapTaskRecordToMobileTaskItem(
      makeTaskRecord({
        task_reminders: [
          {
            id: "reminder-1",
            task_id: "task-1",
            remind_at: "2026-09-01T09:00:00.000Z",
            channel: "email",
            status: "pending",
            sent_at: null,
            failure_reason: null,
            created_at: "2026-08-01T00:00:00.000Z",
            updated_at: "2026-08-01T00:00:00.000Z",
          },
        ],
        task_recurrences: [
          {
            id: "recurrence-1",
            task_id: "task-1",
            rule: "daily",
            anchor_date: "2026-08-01",
            timezone: "UTC",
            next_occurrence_date: "2026-08-23",
            last_generated_at: null,
            created_at: "2026-08-01T00:00:00.000Z",
            updated_at: "2026-08-01T00:00:00.000Z",
          },
        ],
      }),
      0,
    );

    expect(item.reminders).toHaveLength(1);
    expect(item.reminders[0]).toMatchObject({ id: "reminder-1", channel: "email" });
    expect(item.recurrence).toMatchObject({ rule: "daily", nextOccurrenceDate: "2026-08-23" });
  });
});

describe("getMobileTaskCounters", () => {
  it("counts statuses, priorities, pins, overdue, and due-today over the provided scope", () => {
    const counters = getMobileTaskCounters([
      mapTaskRecordToMobileTaskItem(
        makeTaskRecord({ id: "a", status: "in_progress", priority: "urgent", focus_rank: 1 }),
        0,
      ),
      mapTaskRecordToMobileTaskItem(
        makeTaskRecord({ id: "b", status: "todo", priority: "high", due_date: isoDaysFromToday(-1) }),
        0,
      ),
      mapTaskRecordToMobileTaskItem(
        makeTaskRecord({ id: "c", status: "todo", priority: "low", due_date: isoDaysFromToday(0) }),
        0,
      ),
      mapTaskRecordToMobileTaskItem(
        makeTaskRecord({ id: "d", status: "done", priority: "medium", due_date: isoDaysFromToday(-2) }),
        0,
      ),
    ]);

    expect(counters.total).toBe(4);
    expect(counters.byStatus).toEqual({ todo: 2, in_progress: 1, done: 1, blocked: 0 });
    expect(counters.byPriority).toEqual({ low: 1, medium: 1, high: 1, urgent: 1 });
    expect(counters.pinned).toBe(1);
    expect(counters.overdue).toBe(1);
    expect(counters.dueToday).toBe(1);
  });

  it("returns zeroed counters for an empty scope", () => {
    expect(getMobileTaskCounters([])).toEqual({
      total: 0,
      byStatus: { todo: 0, in_progress: 0, done: 0, blocked: 0 },
      byPriority: { low: 0, medium: 0, high: 0, urgent: 0 },
      pinned: 0,
      overdue: 0,
      dueToday: 0,
    });
  });
});

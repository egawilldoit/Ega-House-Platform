import assert from "node:assert/strict";
import test from "node:test";

import {
  clearCompletedToday,
  clearTaskRecurrence,
  createAuthenticatedActor,
  planTaskForToday,
  removeTaskFromToday,
  setTaskRecurrence,
  updateTodayTaskStatus,
  type AuthenticatedActor,
  type RepositoryResult,
  type TaskRecord,
  type TaskRecurrenceRepository,
  type TodayTaskRepository,
} from "../src/index";

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}

const ACTOR = createAuthenticatedActor("user-wave2");
const TASK: TaskRecord = {
  id: "task-1",
  title: "Wave 2",
  description: null,
  blockedReason: null,
  status: "todo",
  priority: "medium",
  dueDate: "2026-08-10",
  estimateMinutes: 30,
  projectId: "project-1",
  goalId: null,
  plannedForDate: null,
  focusRank: null,
  archivedAt: null,
  updatedAt: "2026-08-10T12:00:00.000Z",
  reminders: [],
  recurrence: null,
};

class RecurrenceRepository implements TaskRecurrenceRepository {
  calls: unknown[] = [];
  async setRecurrence(actor: AuthenticatedActor, input: unknown) {
    this.calls.push({ actor: actor.userId, input });
    return ok(TASK);
  }
}

class TodayRepository implements TodayTaskRepository {
  calls: unknown[] = [];
  async setPlannedDate(actor: AuthenticatedActor, input: unknown) {
    this.calls.push({ method: "setPlannedDate", actor: actor.userId, input });
    return ok(TASK);
  }
  async setStatus(actor: AuthenticatedActor, input: unknown) {
    this.calls.push({ method: "setStatus", actor: actor.userId, input });
    return ok(TASK);
  }
  async clearCompletedPlannedDate(actor: AuthenticatedActor, input: unknown) {
    this.calls.push({ method: "clearCompletedPlannedDate", actor: actor.userId, input });
    return ok(2);
  }
}

test("recurrence uses canonical domain normalization and computes next occurrence", async () => {
  const repository = new RecurrenceRepository();
  const result = await setTaskRecurrence(ACTOR, repository, {
    taskId: "task-1",
    recurrenceRule: "weekly:monday",
    recurrenceAnchorDate: "2026-08-10",
    recurrenceTimezone: "UTC",
    fallbackAnchorDate: "2026-08-10",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(repository.calls, [{
    actor: "user-wave2",
    input: {
      taskId: "task-1",
      schedule: {
        rule: "weekly:monday",
        anchorDate: "2026-08-10",
        timezone: "UTC",
        nextOccurrenceDate: "2026-08-17",
      },
    },
  }]);
});

test("unsupported recurrence is rejected before persistence and clear sends a null schedule", async () => {
  const repository = new RecurrenceRepository();
  const invalid = await setTaskRecurrence(ACTOR, repository, {
    taskId: "task-1",
    recurrenceRule: "every-minute",
    fallbackAnchorDate: "2026-08-10",
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.ok || invalid.errorMessage, "Recurring preset is not supported.");
  assert.equal(repository.calls.length, 0);

  const cleared = await clearTaskRecurrence(ACTOR, repository, { taskId: "task-1" });
  assert.equal(cleared.ok, true);
  assert.deepEqual(repository.calls, [{
    actor: "user-wave2",
    input: { taskId: "task-1", schedule: null },
  }]);
});

test("Today mutations stay actor-scoped and date-explicit", async () => {
  const repository = new TodayRepository();

  assert.equal((await planTaskForToday(ACTOR, repository, {
    taskId: "task-1",
    date: "2026-08-10",
  })).ok, true);
  assert.equal((await removeTaskFromToday(ACTOR, repository, { taskId: "task-1" })).ok, true);
  assert.equal((await updateTodayTaskStatus(ACTOR, repository, {
    taskId: "task-1",
    status: "in_progress",
  })).ok, true);
  const cleared = await clearCompletedToday(ACTOR, repository, { date: "2026-08-10" });

  assert.equal(cleared.ok, true);
  assert.equal(cleared.ok && cleared.data.clearedCount, 2);
  assert.deepEqual(repository.calls, [
    {
      method: "setPlannedDate",
      actor: "user-wave2",
      input: { taskId: "task-1", plannedForDate: "2026-08-10" },
    },
    {
      method: "setPlannedDate",
      actor: "user-wave2",
      input: { taskId: "task-1", plannedForDate: null },
    },
    {
      method: "setStatus",
      actor: "user-wave2",
      input: { taskId: "task-1", status: "in_progress", blockedReason: null },
    },
    {
      method: "clearCompletedPlannedDate",
      actor: "user-wave2",
      input: { plannedForDate: "2026-08-10" },
    },
  ]);
});

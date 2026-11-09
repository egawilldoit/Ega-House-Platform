import assert from "node:assert/strict";
import test from "node:test";

import type { OperatorSnapshot, OperatorTask } from "@ega/application";
import { DEFAULT_USER_PREFERENCES, type UserPreferences } from "@ega/domain/preferences";

import {
  buildMorningStartupModel,
  buildStartupErrorReturnPath,
  formatMorningStartupSavedMessage,
  formatWorkTargetMinutes,
  getMorningStartupWeekday,
  MORNING_OUTCOME_ARCHIVED_GOAL_MESSAGE,
  MORNING_OUTCOME_ARCHIVED_MESSAGE,
  MORNING_OUTCOME_ARCHIVED_PROJECT_MESSAGE,
  MORNING_OUTCOME_BLOCKED_MESSAGE,
  MORNING_OUTCOME_COMPLETED_MESSAGE,
  MORNING_OUTCOME_EMPTY_MESSAGE,
  MORNING_OUTCOME_LIMIT_MESSAGE,
  MORNING_OUTCOME_MIXED_PROJECT_MESSAGE,
  MORNING_OUTCOME_REVIEW_MESSAGE,
  MORNING_OUTCOME_UNAVAILABLE_MESSAGE,
  normalizeOutcomeTaskIds,
  parseStartupRetryIds,
  validateMorningOutcomeTasks,
  type MorningStartupOwnedTaskRow,
  type MorningStartupYesterdayRow,
} from "./morning-startup";

function task(overrides: Partial<OperatorTask> & { id: string }): OperatorTask {
  const { id, ...rest } = overrides;
  return {
    id,
    title: `Task ${id}`,
    description: null,
    blockedReason: null,
    status: "todo",
    priority: "medium",
    dueDate: null,
    estimateMinutes: null,
    updatedAt: "2026-11-07T08:00:00.000Z",
    completedAt: null,
    focusRank: null,
    plannedForDate: null,
    scheduledStartAt: null,
    scheduledEndAt: null,
    projectName: "Project A",
    projectSlug: "project-a",
    goalTitle: null,
    hasActiveTimer: false,
    isDueToday: false,
    isPlannedForToday: false,
    dueBucket: "none",
    ...rest,
  };
}

function snapshot(overrides: Partial<OperatorSnapshot> = {}): OperatorSnapshot {
  return {
    date: "2026-11-07",
    timezone: "Africa/Lagos",
    dayWindow: {
      startUtcIso: "2026-11-06T23:00:00.000Z",
      endUtcIso: "2026-11-07T23:00:00.000Z",
    },
    timeContextId: "2026-11-07::Africa/Lagos::2026-11-06T23:00:00.000Z",
    sections: { planned: [], inProgress: [], blocked: [], completed: [] },
    focus: { startHere: null, queue: [] },
    schedule: { blocks: [], flexible: [] },
    plannedToday: [],
    suggestions: { pinned: [], inProgress: [] },
    summary: {
      plannedCount: 0,
      inProgressCount: 0,
      blockedCount: 0,
      completedCount: 0,
      selectedCount: 0,
      clearableCompletedCount: 0,
      overdueCount: 0,
      dueTodayCount: 0,
      totalEstimateMinutes: 0,
      trackedTodaySeconds: 0,
      trackedTodayLabel: "0m",
    },
    activeTimer: null,
    signals: { health: null, friction: null, inbox: null, weeklyObjective: null },
    ...overrides,
  };
}

function preferences(
  overrides: Partial<UserPreferences["personalOperations"]> = {},
): UserPreferences {
  return {
    ...DEFAULT_USER_PREFERENCES,
    personalOperations: {
      ...DEFAULT_USER_PREFERENCES.personalOperations,
      ...overrides,
    },
  };
}

function yesterdayRow(
  overrides: Partial<MorningStartupYesterdayRow> & { id: string },
): MorningStartupYesterdayRow {
  const { id, ...rest } = overrides;
  return {
    id,
    title: `Yesterday ${id}`,
    projectName: "Project A",
    projectSlug: "project-a",
    completedAt: "2026-11-06T18:00:00.000Z",
    ...rest,
  };
}

function ownedRow(
  overrides: Partial<MorningStartupOwnedTaskRow> & { id: string },
): MorningStartupOwnedTaskRow {
  const { id, ...rest } = overrides;
  return {
    id,
    status: "todo",
    archivedAt: null,
    projectId: "project-a",
    projectName: "Project A",
    projectSlug: "project-a",
    projectArchivedAt: null,
    goalId: null,
    goalArchivedAt: null,
    projectRelationPresent: true,
    goalRelationPresent: true,
    ...rest,
  };
}

test("groups actionable tasks by project and derives the primary project from selected outcomes", () => {
  const a1 = task({ id: "a1", projectName: "Alpha", projectSlug: "alpha", isPlannedForToday: true });
  const a2 = task({ id: "a2", projectName: "Alpha", projectSlug: "alpha", isPlannedForToday: true });
  const b1 = task({ id: "b1", projectName: "Beta", projectSlug: "beta" });

  const model = buildMorningStartupModel({
    snapshot: snapshot({
      plannedToday: [a1, a2],
      focus: { startHere: a1, queue: [a1, a2, b1] },
      sections: {
        planned: [a1, a2, b1],
        inProgress: [],
        blocked: [],
        completed: [],
      },
    }),
    yesterdayRows: [],
    preferences: preferences(),
    date: "2026-11-07",
    timezone: "Africa/Lagos",
    skipped: false,
  });

  assert.equal(model.primaryProject?.key, "alpha");
  assert.equal(model.primaryProject?.projectName, "Alpha");
  assert.deepEqual(model.selectedOutcomeIds, ["a1", "a2"]);
  assert.equal(model.plannedActionableCount, 2);
  assert.deepEqual(model.groups.map((group) => group.key), ["alpha", "beta"]);
  assert.equal(model.groups[0]?.isPrimary, true);
  assert.equal(model.groups[1]?.isPrimary, false);
});

test("primary project uses the full planned set, not the three-row display slice", () => {
  const alphaOne = task({
    id: "alpha-1",
    projectName: "Alpha",
    projectSlug: "alpha",
    isPlannedForToday: true,
  });
  const alphaTwo = task({
    id: "alpha-2",
    projectName: "Alpha",
    projectSlug: "alpha",
    isPlannedForToday: true,
  });
  const alphaThree = task({
    id: "alpha-3",
    projectName: "Alpha",
    projectSlug: "alpha",
    isPlannedForToday: true,
  });
  const betaOne = task({
    id: "beta-1",
    projectName: "Beta",
    projectSlug: "beta",
    isPlannedForToday: true,
  });

  const firstOrder = buildMorningStartupModel({
    snapshot: snapshot({ plannedToday: [alphaOne, alphaTwo, alphaThree, betaOne] }),
    yesterdayRows: [],
    preferences: preferences(),
    date: "2026-11-07",
    timezone: "Africa/Lagos",
    skipped: false,
  });
  const reverseOrder = buildMorningStartupModel({
    snapshot: snapshot({ plannedToday: [betaOne, alphaThree, alphaTwo, alphaOne] }),
    yesterdayRows: [],
    preferences: preferences(),
    date: "2026-11-07",
    timezone: "Africa/Lagos",
    skipped: false,
  });

  for (const model of [firstOrder, reverseOrder]) {
    assert.equal(model.primaryProject, null);
    assert.equal(model.plannedActionableCount, 4);
    assert.equal(model.selectedOutcomes.length, 3);
    assert.equal(model.selectedOutcomeIds.length, 3);
  }

  const sameProject = buildMorningStartupModel({
    snapshot: snapshot({ plannedToday: [alphaTwo, alphaOne, alphaThree] }),
    yesterdayRows: [],
    preferences: preferences(),
    date: "2026-11-07",
    timezone: "Africa/Lagos",
    skipped: false,
  });

  assert.equal(sameProject.primaryProject?.key, "alpha");
  assert.equal(sameProject.plannedActionableCount, 3);
  assert.equal(sameProject.selectedOutcomes.length, 3);
});

test("additive project switching yields no primary and no group badge", () => {
  const alpha = task({
    id: "alpha-planned",
    projectName: "Alpha",
    projectSlug: "alpha",
    isPlannedForToday: true,
  });
  const beta = task({
    id: "beta-planned",
    projectName: "Beta",
    projectSlug: "beta",
    isPlannedForToday: true,
  });

  const model = buildMorningStartupModel({
    snapshot: snapshot({
      plannedToday: [alpha, beta],
      focus: { startHere: alpha, queue: [alpha, beta] },
    }),
    yesterdayRows: [],
    preferences: preferences(),
    date: "2026-11-07",
    timezone: "Africa/Lagos",
    skipped: false,
  });

  assert.equal(model.primaryProject, null);
  assert.equal(model.plannedActionableCount, 2);
  assert.deepEqual(model.selectedOutcomes.map((item) => item.id), [
    "alpha-planned",
    "beta-planned",
  ]);
  assert.ok(model.groups.some((group) => group.key === "alpha"));
  assert.ok(model.groups.some((group) => group.key === "beta"));
  assert.equal(model.groups.every((group) => !group.isPrimary), true);
});

test("normalizeOutcomeTaskIds accepts 1-3 and rejects 0 and 4 with distinct messages", () => {
  assert.deepEqual(normalizeOutcomeTaskIds(["a"]), { ok: true, taskIds: ["a"] });
  assert.deepEqual(normalizeOutcomeTaskIds(["a", "b", "c"]), {
    ok: true,
    taskIds: ["a", "b", "c"],
  });

  assert.deepEqual(normalizeOutcomeTaskIds([]), {
    ok: false,
    errorMessage: MORNING_OUTCOME_EMPTY_MESSAGE,
  });
  assert.deepEqual(normalizeOutcomeTaskIds(["a", "b", "c", "d"]), {
    ok: false,
    errorMessage: MORNING_OUTCOME_LIMIT_MESSAGE,
  });
  assert.notEqual(MORNING_OUTCOME_EMPTY_MESSAGE, MORNING_OUTCOME_LIMIT_MESSAGE);
});

test("normalizeOutcomeTaskIds trims and dedupes while preserving submitted order", () => {
  assert.deepEqual(normalizeOutcomeTaskIds([" b ", "a", "b", "  ", "a"]), {
    ok: true,
    taskIds: ["b", "a"],
  });
});

test("validateMorningOutcomeTasks rejects tasks from mixed projects", () => {
  const result = validateMorningOutcomeTasks([
    ownedRow({ id: "a", projectId: "project-a" }),
    ownedRow({ id: "b", projectId: "project-b" }),
  ]);

  assert.deepEqual(result, {
    ok: false,
    errorMessage: MORNING_OUTCOME_MIXED_PROJECT_MESSAGE,
  });
});

test("validateMorningOutcomeTasks rejects completed, blocked, review and archived rows", () => {
  assert.deepEqual(validateMorningOutcomeTasks([ownedRow({ id: "done", status: "done" })]), {
    ok: false,
    errorMessage: MORNING_OUTCOME_COMPLETED_MESSAGE,
  });
  assert.deepEqual(validateMorningOutcomeTasks([ownedRow({ id: "blocked", status: "blocked" })]), {
    ok: false,
    errorMessage: MORNING_OUTCOME_BLOCKED_MESSAGE,
  });
  assert.deepEqual(validateMorningOutcomeTasks([ownedRow({ id: "review", status: "review" })]), {
    ok: false,
    errorMessage: MORNING_OUTCOME_REVIEW_MESSAGE,
  });
  assert.deepEqual(
    validateMorningOutcomeTasks([
      ownedRow({ id: "archived", archivedAt: "2026-11-01T00:00:00.000Z" }),
    ]),
    { ok: false, errorMessage: MORNING_OUTCOME_ARCHIVED_MESSAGE },
  );
  assert.deepEqual(
    validateMorningOutcomeTasks([
      ownedRow({
        id: "archived-project",
        projectArchivedAt: "2026-11-01T00:00:00.000Z",
      }),
    ]),
    { ok: false, errorMessage: MORNING_OUTCOME_ARCHIVED_PROJECT_MESSAGE },
  );
  assert.deepEqual(
    validateMorningOutcomeTasks([
      ownedRow({ id: "archived-goal", goalArchivedAt: "2026-11-01T00:00:00.000Z" }),
    ]),
    { ok: false, errorMessage: MORNING_OUTCOME_ARCHIVED_GOAL_MESSAGE },
  );
  assert.deepEqual(validateMorningOutcomeTasks([]), {
    ok: false,
    errorMessage: "The selected outcome tasks are unavailable.",
  });
});

test("validateMorningOutcomeTasks fails closed when a referenced relation is missing", () => {
  assert.deepEqual(
    validateMorningOutcomeTasks([
      ownedRow({ id: "missing-project", projectRelationPresent: false }),
    ]),
    { ok: false, errorMessage: MORNING_OUTCOME_UNAVAILABLE_MESSAGE },
  );
  assert.deepEqual(
    validateMorningOutcomeTasks([
      ownedRow({
        id: "missing-goal",
        goalId: "goal-1",
        goalRelationPresent: false,
      }),
    ]),
    { ok: false, errorMessage: MORNING_OUTCOME_UNAVAILABLE_MESSAGE },
  );

  const accepted = validateMorningOutcomeTasks([
    ownedRow({ id: "no-goal", goalId: null }),
  ]);
  assert.equal(accepted.ok, true);
  if (accepted.ok) {
    assert.deepEqual(accepted.tasks.map((row) => row.id), ["no-goal"]);
  }
});

test("weekend targets and rest days come from the configured weekday target", () => {
  const saturday = buildMorningStartupModel({
    snapshot: snapshot({ date: "2026-11-07" }),
    yesterdayRows: [],
    preferences: preferences({
      targets: {
        ...DEFAULT_USER_PREFERENCES.personalOperations.targets,
        saturday: { work: 240, jobSearch: 0 },
      },
    }),
    date: "2026-11-07",
    timezone: "Africa/Lagos",
    skipped: false,
  });

  assert.equal(saturday.weekday, "saturday");
  assert.equal(saturday.workTargetMinutes, 240);
  assert.equal(saturday.workTargetLabel, "4h");
  assert.equal(saturday.isRestDay, false);

  const sunday = buildMorningStartupModel({
    snapshot: snapshot({ date: "2026-11-08" }),
    yesterdayRows: [],
    preferences: preferences({
      targets: {
        ...DEFAULT_USER_PREFERENCES.personalOperations.targets,
        sunday: { work: 0, jobSearch: 0 },
      },
    }),
    date: "2026-11-08",
    timezone: "Africa/Lagos",
    skipped: false,
  });

  assert.equal(sunday.weekday, "sunday");
  assert.equal(sunday.workTargetMinutes, 0);
  assert.equal(sunday.workTargetLabel, "No work target");
  assert.equal(sunday.isRestDay, true);
});

test("paused schedule state is carried into the model without changing the target", () => {
  const model = buildMorningStartupModel({
    snapshot: snapshot({ date: "2026-11-07" }),
    yesterdayRows: [],
    preferences: preferences({ paused: true }),
    date: "2026-11-07",
    timezone: "Africa/Lagos",
    skipped: false,
  });

  assert.equal(model.paused, true);
  assert.equal(model.workTargetMinutes, 240);
});

test("yesterday rows and carryovers map canonical state without duplicating planned work", () => {
  const inProgress = task({
    id: "carry-in-progress",
    status: "in_progress",
    projectName: "Alpha",
    projectSlug: "alpha",
  });
  const plannedOpen = task({
    id: "carry-planned",
    projectName: "Alpha",
    projectSlug: "alpha",
  });
  const plannedToday = task({
    id: "already-planned",
    isPlannedForToday: true,
    projectName: "Alpha",
    projectSlug: "alpha",
  });
  // Deliberately misplaced in the carryover lanes: the renderer must filter by
  // status, not trust the section a row arrived in.
  const blockedInPlanned = task({ id: "blocked-in-planned", status: "blocked" });
  const completedInPlanned = task({ id: "completed-in-planned", status: "done" });
  const blockedInProgress = task({
    id: "blocked-in-progress",
    status: "blocked",
  });
  const completedInProgress = task({
    id: "completed-in-progress",
    status: "done",
  });

  const model = buildMorningStartupModel({
    snapshot: snapshot({
      date: "2026-11-07",
      sections: {
        planned: [plannedOpen, plannedToday, blockedInPlanned, completedInPlanned],
        inProgress: [inProgress, blockedInProgress, completedInProgress],
        blocked: [],
        completed: [],
      },
      plannedToday: [plannedToday],
    }),
    yesterdayRows: [
      yesterdayRow({ id: "y1", title: "Ship review", completedAt: "2026-11-06T18:00:00.000Z" }),
      yesterdayRow({ id: "y2", title: "Fix CI", completedAt: "2026-11-06T17:00:00.000Z" }),
    ],
    preferences: preferences(),
    date: "2026-11-07",
    timezone: "Africa/Lagos",
    skipped: false,
  });

  assert.equal(model.yesterday.completedCount, 2);
  assert.deepEqual(model.yesterday.tasks.map((item) => item.id), ["y1", "y2"]);
  assert.equal(model.carryovers.count, 2);
  assert.deepEqual(model.carryovers.tasks.map((item) => item.id), [
    "carry-in-progress",
    "carry-planned",
  ]);
  assert.doesNotMatch(
    model.carryovers.tasks.map((item) => item.id).join(","),
    /blocked|completed/,
  );
});

test("rendered lists are bounded: yesterday 5, carryovers 5, 4 groups x 5 tasks", () => {
  const manyYesterday = Array.from({ length: 8 }, (_, index) =>
    yesterdayRow({ id: `y${index}` }),
  );
  const manyCarryovers = Array.from({ length: 8 }, (_, index) =>
    task({ id: `c${index}`, status: "in_progress" }),
  );
  const manyProjects = Array.from({ length: 6 }, (_, index) =>
    task({
      id: `p${index}-task`,
      projectName: `Project ${index}`,
      projectSlug: `project-${index}`,
    }),
  );
  const manyInOneProject = Array.from({ length: 8 }, (_, index) =>
    task({ id: `same-${index}`, projectName: "Same", projectSlug: "same" }),
  );

  const bounded = buildMorningStartupModel({
    snapshot: snapshot({
      sections: {
        planned: manyCarryovers,
        inProgress: [],
        blocked: [],
        completed: [],
      },
      focus: { startHere: null, queue: [...manyProjects, ...manyInOneProject] },
    }),
    yesterdayRows: manyYesterday,
    yesterdayCompletedCount: 21,
    preferences: preferences(),
    date: "2026-11-07",
    timezone: "Africa/Lagos",
    skipped: false,
  });

  assert.equal(bounded.yesterday.completedCount, 21);
  assert.equal(bounded.yesterday.tasks.length, 5);
  assert.equal(bounded.carryovers.count, 8);
  assert.equal(bounded.carryovers.tasks.length, 5);
  assert.equal(bounded.groups.length, 4);

  const sameProject = buildMorningStartupModel({
    snapshot: snapshot({
      focus: { startHere: null, queue: manyInOneProject },
    }),
    yesterdayRows: [],
    preferences: preferences(),
    date: "2026-11-07",
    timezone: "Africa/Lagos",
    skipped: false,
  });

  assert.equal(sameProject.groups.length, 1);
  assert.equal(sameProject.groups[0]?.tasks.length, 5);
});

test("retry ids only pre-check ids that are actually rendered candidates", () => {
  const candidate = task({
    id: "rendered-candidate",
    projectName: "Alpha",
    projectSlug: "alpha",
  });

  const model = buildMorningStartupModel({
    snapshot: snapshot({ focus: { startHere: null, queue: [candidate] } }),
    yesterdayRows: [],
    preferences: preferences(),
    date: "2026-11-07",
    timezone: "Africa/Lagos",
    skipped: false,
    retrySelectedIds: ["rendered-candidate", "not-rendered", "bad id"],
  });

  assert.deepEqual(model.retrySelectedIds, ["rendered-candidate"]);
});

test("parseStartupRetryIds trims, dedupes, caps at 8 and ignores unsafe values", () => {
  assert.deepEqual(parseStartupRetryIds([" a ", "a", "b", "", "bad id", "../x", "ok_2"]), [
    "a",
    "b",
    "ok_2",
  ]);
  assert.deepEqual(parseStartupRetryIds("a,b,a"), ["a", "b"]);
  assert.deepEqual(parseStartupRetryIds(["a", "b", "c", "d"]), ["a", "b", "c", "d"]);
  assert.deepEqual(parseStartupRetryIds(null), []);
  assert.deepEqual(parseStartupRetryIds(["a/b", "a b", "a.b"]), []);
  assert.equal(
    parseStartupRetryIds(Array.from({ length: 12 }, (_, index) => `id-${index}`)).length,
    8,
  );
});

test("error return path preserves the retry selection and success carries none", () => {
  assert.equal(buildStartupErrorReturnPath("/today", []), "/today");
  assert.equal(
    buildStartupErrorReturnPath("/today", ["a", "b"]),
    "/today?startupRetry=a%2Cb",
  );
  assert.equal(
    buildStartupErrorReturnPath("/today?startup=open", ["a"]),
    "/today?startup=open&startupRetry=a",
  );
});

test("saved message uses the singular for one outcome", () => {
  assert.equal(
    formatMorningStartupSavedMessage(1),
    "Morning startup saved: 1 outcome for today.",
  );
  assert.equal(
    formatMorningStartupSavedMessage(2),
    "Morning startup saved: 2 outcomes for today.",
  );
});

test("preferences failure is carried as a degraded-note flag", () => {
  const model = buildMorningStartupModel({
    snapshot: snapshot(),
    yesterdayRows: [],
    preferences: preferences(),
    date: "2026-11-07",
    timezone: "Africa/Lagos",
    skipped: false,
    preferencesErrorMessage: "Unable to load preferences right now.",
  });

  assert.equal(model.preferencesErrorMessage, "Unable to load preferences right now.");
});

test("weekday and work-target labels are deterministic and human readable", () => {
  assert.equal(getMorningStartupWeekday("2026-11-07"), "saturday");
  assert.equal(getMorningStartupWeekday("2026-11-08"), "sunday");
  assert.equal(formatWorkTargetMinutes(480), "8h");
  assert.equal(formatWorkTargetMinutes(210), "3h 30m");
  assert.equal(formatWorkTargetMinutes(45), "45m");
  assert.equal(formatWorkTargetMinutes(0), "No work target");
});

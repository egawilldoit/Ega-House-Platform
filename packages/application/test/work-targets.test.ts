import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PERSONAL_OPERATIONS,
  type JobSearchReference,
  type PersonalOperations,
} from "@ega/domain";

import type { ExecutionEvidenceSessionRow } from "../src/shared/execution-evidence";
import { calculateWorkTargetProgress } from "../src/work-targets/progress";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";

function schedule(reference: JobSearchReference | null = null): PersonalOperations {
  return { ...DEFAULT_PERSONAL_OPERATIONS, jobSearchReference: reference };
}

function session(
  overrides: Partial<ExecutionEvidenceSessionRow> & { task_id: string; started_at: string },
): ExecutionEvidenceSessionRow {
  return {
    ended_at: "2026-03-02T10:00:00.000Z",
    duration_seconds: null,
    tasks: null,
    ...overrides,
  };
}

test("default weekly targets are 48h work and 450m job search", () => {
  const progress = calculateWorkTargetProgress({
    sessions: [],
    personalOperations: schedule(),
    timezone: "UTC",
    nowIso: "2026-03-04T12:00:00.000Z",
  });

  assert.equal(progress.days.length, 7);
  assert.equal(progress.week.targetWorkMinutes, 2880);
  assert.equal(progress.week.targetJobSearchMinutes, 450);
  assert.deepEqual(
    progress.days.map((day) => [day.targetWorkMinutes, day.targetJobSearchMinutes]),
    [
      [480, 90],
      [480, 90],
      [480, 90],
      [480, 90],
      [480, 90],
      [240, 0],
      [240, 0],
    ],
  );
});

test("a 90-minute job-search session is 90 work and 90 search, never 180", () => {
  const progress = calculateWorkTargetProgress({
    sessions: [
      session({
        task_id: TASK_ID,
        started_at: "2026-03-02T09:00:00.000Z",
        ended_at: "2026-03-02T10:30:00.000Z",
      }),
    ],
    personalOperations: schedule({ kind: "task", id: TASK_ID }),
    timezone: "UTC",
    nowIso: "2026-03-02T12:00:00.000Z",
  });

  assert.equal(progress.today.actualWorkMinutes, 90);
  assert.equal(progress.today.actualJobSearchMinutes, 90);
  assert.equal(progress.week.actualWorkMinutes, 90);
  assert.equal(progress.week.actualJobSearchMinutes, 90);
  assert.equal(progress.jobSearchConfigured, true);
});

test("job search without a reference is reported as not configured", () => {
  const progress = calculateWorkTargetProgress({
    sessions: [],
    personalOperations: schedule(null),
    timezone: "UTC",
    nowIso: "2026-03-02T12:00:00.000Z",
  });

  assert.equal(progress.reference, null);
  assert.equal(progress.jobSearchConfigured, false);
  assert.equal(progress.week.actualJobSearchMinutes, 0);
  assert.equal(progress.week.targetJobSearchMinutes, 450);
});

test("weekend zero targets need no configured reference", () => {
  // Saturday 2026-03-07. The Saturday row has 0 search target, so it is
  // configured even with no reference; the week still needs one for weekdays.
  const progress = calculateWorkTargetProgress({
    sessions: [],
    personalOperations: schedule(null),
    timezone: "UTC",
    nowIso: "2026-03-07T12:00:00.000Z",
  });

  assert.equal(progress.today.dayOfWeek, "saturday");
  assert.equal(progress.today.targetWorkMinutes, 240);
  assert.equal(progress.today.targetJobSearchMinutes, 0);
  assert.equal(progress.today.jobSearchConfigured, true);
  assert.equal(progress.jobSearchConfigured, false);
});

test("cross-midnight sessions split by local day without double counting", () => {
  // Tuesday 22:00 EST -> Wednesday 02:00 EST (4 hours, 2 hours each side).
  const progress = calculateWorkTargetProgress({
    sessions: [
      session({
        task_id: TASK_ID,
        started_at: "2026-03-04T03:00:00.000Z",
        ended_at: "2026-03-04T07:00:00.000Z",
      }),
    ],
    personalOperations: schedule({ kind: "task", id: TASK_ID }),
    timezone: "America/New_York",
    nowIso: "2026-03-04T12:00:00.000Z",
  });

  const tuesday = progress.days.find((day) => day.date === "2026-03-03");
  const wednesday = progress.days.find((day) => day.date === "2026-03-04");
  assert.equal(tuesday?.actualWorkMinutes, 120);
  assert.equal(tuesday?.actualJobSearchMinutes, 120);
  assert.equal(wednesday?.actualWorkMinutes, 120);
  assert.equal(wednesday?.actualJobSearchMinutes, 120);
  assert.equal(progress.week.actualWorkMinutes, 240);
  assert.equal(progress.week.actualJobSearchMinutes, 240);
});

test("DST spring-forward keeps local-day totals and week boundaries", () => {
  // Saturday 23:00 EST -> Sunday 04:00 EDT. Local midnight is 05:00Z and the
  // 04:00Z->08:00Z interval is 4 real hours, so Sunday carries 3 hours.
  const progress = calculateWorkTargetProgress({
    sessions: [
      session({
        task_id: TASK_ID,
        started_at: "2026-03-08T04:00:00.000Z",
        ended_at: "2026-03-08T08:00:00.000Z",
      }),
    ],
    personalOperations: schedule({ kind: "task", id: TASK_ID }),
    timezone: "America/New_York",
    nowIso: "2026-03-08T12:00:00.000Z",
  });

  assert.equal(progress.weekStart, "2026-03-02");
  assert.equal(progress.weekEnd, "2026-03-08");
  assert.equal(progress.weekStartUtcIso, "2026-03-02T05:00:00.000Z");
  assert.equal(progress.weekEndExclusiveUtcIso, "2026-03-09T04:00:00.000Z");
  assert.equal(progress.todayDate, "2026-03-08");

  const saturday = progress.days.find((day) => day.date === "2026-03-07");
  const sunday = progress.days.find((day) => day.date === "2026-03-08");
  assert.equal(saturday?.actualWorkMinutes, 60);
  assert.equal(saturday?.actualJobSearchMinutes, 60);
  assert.equal(sunday?.actualWorkMinutes, 180);
  assert.equal(sunday?.actualJobSearchMinutes, 180);
  assert.equal(progress.week.actualWorkMinutes, 240);
  assert.equal(progress.week.actualJobSearchMinutes, 240);
});

test("manual closed entries use their timestamps, not duration_seconds", () => {
  const progress = calculateWorkTargetProgress({
    sessions: [
      session({
        task_id: TASK_ID,
        started_at: "2026-03-02T09:00:00.000Z",
        ended_at: "2026-03-02T09:30:00.000Z",
        duration_seconds: 9999,
      }),
    ],
    personalOperations: schedule({ kind: "task", id: TASK_ID }),
    timezone: "UTC",
    nowIso: "2026-03-02T12:00:00.000Z",
  });

  assert.equal(progress.today.actualWorkMinutes, 30);
  assert.equal(progress.today.actualJobSearchMinutes, 30);
});

test("empty history reports explicit insufficient quality and zero actuals", () => {
  const progress = calculateWorkTargetProgress({
    sessions: [],
    personalOperations: schedule({ kind: "task", id: TASK_ID }),
    timezone: "UTC",
    nowIso: "2026-03-04T12:00:00.000Z",
  });

  assert.equal(progress.quality, "insufficient");
  assert.equal(progress.week.actualWorkMinutes, 0);
  assert.equal(progress.week.actualJobSearchMinutes, 0);
});

test("partial week marks future days and sums only elapsed targets", () => {
  const progress = calculateWorkTargetProgress({
    sessions: [],
    personalOperations: schedule({ kind: "task", id: TASK_ID }),
    timezone: "UTC",
    nowIso: "2026-03-03T12:00:00.000Z",
  });

  assert.deepEqual(
    progress.days.map((day) => day.isFuture),
    [false, false, true, true, true, true, true],
  );
  assert.equal(progress.week.weekToDateTargetWorkMinutes, 960);
  assert.equal(progress.week.weekToDateTargetJobSearchMinutes, 180);
  assert.equal(progress.week.targetWorkMinutes, 2880);
});

test("open sessions are excluded by default and provisional when included", () => {
  const sessions = [
    session({
      task_id: TASK_ID,
      started_at: "2026-03-02T09:00:00.000Z",
      ended_at: null,
    }),
  ];
  const nowIso = "2026-03-02T10:00:00.000Z";

  const excluded = calculateWorkTargetProgress({
    sessions,
    personalOperations: schedule({ kind: "task", id: TASK_ID }),
    timezone: "UTC",
    nowIso,
  });
  assert.equal(excluded.today.actualWorkMinutes, 0);
  assert.equal(excluded.today.actualJobSearchMinutes, 0);
  assert.equal(excluded.quality, "insufficient");
  assert.equal(excluded.includeOpenSessions, false);

  const included = calculateWorkTargetProgress({
    sessions,
    personalOperations: schedule({ kind: "task", id: TASK_ID }),
    timezone: "UTC",
    nowIso,
    includeOpenSessions: true,
  });
  assert.equal(included.today.actualWorkMinutes, 60);
  assert.equal(included.today.actualJobSearchMinutes, 60);
  assert.equal(included.quality, "provisional");
  assert.equal(included.includeOpenSessions, true);
});

test("rename and reprojection keep task-id classification stable", () => {
  const progress = calculateWorkTargetProgress({
    sessions: [
      session({
        task_id: TASK_ID,
        started_at: "2026-03-02T09:00:00.000Z",
        ended_at: "2026-03-02T10:00:00.000Z",
        tasks: {
          id: TASK_ID,
          title: "A completely different title",
          // The task moved to another project after the session was recorded.
          project_id: OTHER_ID,
          projects: { id: OTHER_ID, name: "Another project" },
        },
      }),
    ],
    personalOperations: schedule({ kind: "task", id: TASK_ID }),
    timezone: "UTC",
    nowIso: "2026-03-02T12:00:00.000Z",
  });

  assert.equal(progress.today.actualWorkMinutes, 60);
  assert.equal(progress.today.actualJobSearchMinutes, 60);
});

test("an archived task keeps its id-based job-search classification", () => {
  const archivedRow = {
    task_id: TASK_ID,
    started_at: "2026-03-02T09:00:00.000Z",
    ended_at: "2026-03-02T10:00:00.000Z",
    duration_seconds: null,
    tasks: {
      id: TASK_ID,
      title: "Renamed after archiving",
      archived_at: "2026-03-03T00:00:00.000Z",
    },
  } as unknown as ExecutionEvidenceSessionRow;

  const progress = calculateWorkTargetProgress({
    sessions: [archivedRow],
    personalOperations: schedule({ kind: "task", id: TASK_ID }),
    timezone: "UTC",
    nowIso: "2026-03-02T12:00:00.000Z",
  });

  assert.equal(progress.today.actualWorkMinutes, 60);
  assert.equal(progress.today.actualJobSearchMinutes, 60);
});

test("project references classify through either project id field", () => {
  for (const tasks of [
    { id: OTHER_ID, project_id: PROJECT_ID },
    { id: OTHER_ID, projects: { id: PROJECT_ID, name: "Renamed project" } },
    { id: OTHER_ID, project_id: OTHER_ID, projects: { id: PROJECT_ID, name: "Renamed" } },
  ]) {
    const progress = calculateWorkTargetProgress({
      sessions: [
        session({
          task_id: OTHER_ID,
          started_at: "2026-03-02T09:00:00.000Z",
          ended_at: "2026-03-02T10:00:00.000Z",
          tasks,
        }),
      ],
      personalOperations: schedule({ kind: "project", id: PROJECT_ID }),
      timezone: "UTC",
      nowIso: "2026-03-02T12:00:00.000Z",
    });

    assert.equal(progress.today.actualJobSearchMinutes, 60, JSON.stringify(tasks));
  }
});

test("title similarity never classifies as job search", () => {
  const progress = calculateWorkTargetProgress({
    sessions: [
      session({
        task_id: OTHER_ID,
        started_at: "2026-03-02T09:00:00.000Z",
        ended_at: "2026-03-02T10:00:00.000Z",
        tasks: {
          id: OTHER_ID,
          title: "Job search — applications and interviews",
        },
      }),
    ],
    personalOperations: schedule({ kind: "task", id: TASK_ID }),
    timezone: "UTC",
    nowIso: "2026-03-02T12:00:00.000Z",
  });

  assert.equal(progress.today.actualWorkMinutes, 60);
  assert.equal(progress.today.actualJobSearchMinutes, 0);
});

test("sessions outside the current week are excluded", () => {
  const progress = calculateWorkTargetProgress({
    sessions: [
      session({
        task_id: TASK_ID,
        started_at: "2026-03-01T10:00:00.000Z",
        ended_at: "2026-03-01T11:00:00.000Z",
      }),
    ],
    personalOperations: schedule({ kind: "task", id: TASK_ID }),
    timezone: "UTC",
    nowIso: "2026-03-04T12:00:00.000Z",
  });

  assert.equal(progress.week.actualWorkMinutes, 0);
  assert.equal(progress.week.actualJobSearchMinutes, 0);
});

test("malformed sessions are suspect and contribute nothing", () => {
  const progress = calculateWorkTargetProgress({
    sessions: [
      session({
        task_id: TASK_ID,
        started_at: "2026-03-02T12:00:00.000Z",
        ended_at: "2026-03-02T11:00:00.000Z",
      }),
    ],
    personalOperations: schedule({ kind: "task", id: TASK_ID }),
    timezone: "UTC",
    nowIso: "2026-03-02T15:00:00.000Z",
  });

  assert.equal(progress.quality, "suspect");
  assert.equal(progress.week.actualWorkMinutes, 0);
});

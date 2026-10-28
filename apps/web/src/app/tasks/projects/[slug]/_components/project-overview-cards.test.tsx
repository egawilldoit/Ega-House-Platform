import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ProjectProgressSummary } from "@ega/application";

import { buildProjectProgress } from "@ega/application";

import { ProjectActivityCard } from "./project-activity-card";
import { ProjectComingUp } from "./project-coming-up";
import { ProjectGoalsMilestones } from "./project-goals-milestones";
import { ProjectProgressCard } from "./project-progress-card";
import { ProjectTimeCard } from "./project-time-card";
import { selectProjectComingUpTasks } from "@/lib/project-overview";

function progress(tasks: Array<{ status: string }>): ProjectProgressSummary {
  return buildProjectProgress(tasks);
}

test("progress card names completion and deep-links each status segment", () => {
  const markup = renderToStaticMarkup(
    <ProjectProgressCard
      projectId="project-1"
      progress={progress([
        { status: "todo" },
        { status: "in_progress" },
        { status: "done" },
        { status: "done" },
      ])}
      archivedTaskCount={0}
    />,
  );

  assert.match(markup, /50%/);
  assert.match(markup, /2\/4 done/);
  assert.match(markup, /aria-label="Project completion"/);
  assert.match(markup, /2 of 4 tasks done \(50%\)/);
  assert.match(markup, /\/tasks\?project=project-1&amp;status=done/);
  assert.match(markup, /\/tasks\?project=project-1&amp;status=in_progress/);
  assert.match(markup, /open the filtered task list/);
});

test("progress card has an honest zero state with no active tasks", () => {
  const markup = renderToStaticMarkup(
    <ProjectProgressCard projectId="project-1" progress={progress([])} archivedTaskCount={3} />,
  );

  assert.match(markup, /0%/);
  assert.match(markup, /No active tasks yet/);
  assert.match(markup, /3 archived/);
  assert.doesNotMatch(markup, /\/tasks\?project=project-1&amp;status=/);
});

test("coming up renders at most six tasks and an empty state", () => {
  const tasks = Array.from({ length: 8 }, (_, index) => ({
    id: `task-${index}`,
    title: `Task ${index}`,
    status: "todo",
    due_date: `2026-12-${String(10 + index).padStart(2, "0")}`,
    planned_for_date: null,
    scheduled_start_at: null,
    archived_at: null,
  }));
  const items = selectProjectComingUpTasks(tasks, {
    today: "2026-12-07",
    timezone: "UTC",
    limit: 6,
  });
  const markup = renderToStaticMarkup(<ProjectComingUp items={items} returnTo="/tasks/projects/demo" />);

  assert.match(markup, /Task 5/);
  assert.doesNotMatch(markup, /Task 6/);
  assert.match(markup, /Next scheduled work/);

  const emptyMarkup = renderToStaticMarkup(
    <ProjectComingUp items={[]} returnTo="/tasks/projects/demo" />,
  );
  assert.match(emptyMarkup, /Nothing is due or scheduled yet/);
});

test("goal milestones render health and next step and keep long lists bounded", () => {
  const goals = Array.from({ length: 24 }, (_, index) => ({
    id: `goal-${index}`,
    title: `Goal ${index}`,
    projectId: "project-1",
    health: index === 0 ? "at_risk" : null,
    nextStep: index === 0 ? "Book the survey" : null,
  }));
  const markup = renderToStaticMarkup(<ProjectGoalsMilestones goals={goals} />);

  assert.match(markup, /Goal 23/);
  assert.match(markup, /At Risk/);
  assert.match(markup, /Next: Book the survey/);
  assert.match(markup, /No next step set/);
  assert.match(markup, /max-h-\[22rem\] overflow-y-auto/);

  const emptyMarkup = renderToStaticMarkup(<ProjectGoalsMilestones goals={[]} />);
  assert.match(emptyMarkup, /No goals are linked to this project yet/);
});

test("time card distinguishes no-estimate, tracked and estimate states", () => {
  const noEstimate = renderToStaticMarkup(
    <ProjectTimeCard
      archivedTaskCount={0}
      summary={{
        weekTrackedSeconds: 0,
        weekSessionCount: 0,
        totalTrackedSeconds: 0,
        estimatedMinutes: 0,
        estimatedTaskCount: 0,
      }}
    />,
  );
  assert.match(noEstimate, /No estimate/);
  assert.match(noEstimate, /No time has been tracked/);
  assert.doesNotMatch(noEstimate, /role="progressbar"/);

  const tracked = renderToStaticMarkup(
    <ProjectTimeCard
      archivedTaskCount={2}
      summary={{
        weekTrackedSeconds: 3600,
        weekSessionCount: 2,
        totalTrackedSeconds: 7200,
        estimatedMinutes: 60,
        estimatedTaskCount: 1,
      }}
    />,
  );
  assert.match(tracked, /1h/);
  assert.match(tracked, /2h 0m 0s/);
  assert.match(tracked, /role="progressbar"/);
  assert.match(tracked, /Historical time for archived tasks stays included/);
});

test("activity card renders the owner read model and its empty state", () => {
  const markup = renderToStaticMarkup(
    <ProjectActivityCard
      taskTitles={new Map([["task-1", "Paint the kitchen"]])}
      items={[
        {
          id: "status-1",
          taskId: "task-1",
          kind: "status",
          occurredAt: "2026-12-07T10:00:00.000Z",
          actor: { kind: "owner", userId: "user-1", label: null },
          summary: "Status changed from todo to done",
        },
      ]}
    />,
  );
  assert.match(markup, /Paint the kitchen/);
  assert.match(markup, /Status changed from todo to done/);
  assert.match(markup, /You/);

  const emptyMarkup = renderToStaticMarkup(
    <ProjectActivityCard items={[]} taskTitles={new Map()} />,
  );
  assert.match(emptyMarkup, /No task activity has been recorded/);
});

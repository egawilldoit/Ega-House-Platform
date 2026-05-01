import assert from "node:assert/strict";
import test from "node:test";

import { parseQuickTaskCommand } from "./quick-task-command-parser";

const projects = [
  { id: "project-1", name: "Execution OS" },
  { id: "project-2", name: "Content Engine" },
];

const goals = [
  { id: "goal-1", title: "Launch Checklist", project_id: "project-1" },
  { id: "goal-2", title: "Editorial Sprint", project_id: "project-2" },
  { id: "goal-3", title: "Launch", project_id: "project-2" },
];

const monday = new Date("2026-04-27T12:00:00.000Z");

test("parses title project today priority and estimate", () => {
  const result = parseQuickTaskCommand(
    "Ship parser #ExecutionOS today p2 45m",
    projects,
    { now: monday },
  );

  assert.equal(result.title, "Ship parser");
  assert.equal(result.projectId, "project-1");
  assert.equal(result.projectName, "Execution OS");
  assert.equal(result.dueDate, "2026-04-27");
  assert.equal(result.priority, "high");
  assert.equal(result.estimateMinutes, 45);
  assert.equal(result.projectError, null);
});

test("parses existing priority values and prefixed numeric estimate", () => {
  const result = parseQuickTaskCommand(
    "Refine task capture #ContentEngine urgent estimate:30",
    projects,
    { now: monday },
  );

  assert.equal(result.title, "Refine task capture");
  assert.equal(result.projectId, "project-2");
  assert.equal(result.priority, "urgent");
  assert.equal(result.estimateMinutes, 30);
});

test("parses compact hour estimates", () => {
  const result = parseQuickTaskCommand("Prepare launch high 2h", projects, {
    now: monday,
  });

  assert.equal(result.title, "Prepare launch");
  assert.equal(result.priority, "high");
  assert.equal(result.estimateMinutes, 120);
});

test("parses slash goal inside selected project", () => {
  const result = parseQuickTaskCommand(
    "Ship parser /LaunchChecklist today",
    projects,
    goals,
    { now: monday, selectedProjectId: "project-1" },
  );

  assert.equal(result.title, "Ship parser");
  assert.equal(result.goalToken, "LaunchChecklist");
  assert.equal(result.goalId, "goal-1");
  assert.equal(result.goalName, "Launch Checklist");
  assert.equal(result.goalError, null);
  assert.equal(result.dueDate, "2026-04-27");
});

test("parses slash goal inside parsed project", () => {
  const result = parseQuickTaskCommand(
    "Draft assets #ContentEngine /Launch",
    projects,
    goals,
    { now: monday, selectedProjectId: "project-1" },
  );

  assert.equal(result.title, "Draft assets");
  assert.equal(result.projectId, "project-2");
  assert.equal(result.goalId, "goal-3");
  assert.equal(result.goalName, "Launch");
});

test("parses spaced goal token", () => {
  const result = parseQuickTaskCommand(
    "Prep review goal:Editorial Sprint tomorrow high",
    projects,
    goals,
    { now: monday, selectedProjectId: "project-2" },
  );

  assert.equal(result.title, "Prep review");
  assert.equal(result.goalToken, "Editorial Sprint");
  assert.equal(result.goalId, "goal-2");
  assert.equal(result.priority, "high");
  assert.equal(result.dueDate, "2026-04-28");
});

test("unknown goal returns clear goal error", () => {
  const result = parseQuickTaskCommand(
    "Prep review /MissingGoal",
    projects,
    goals,
    { now: monday, selectedProjectId: "project-1" },
  );

  assert.equal(result.title, "Prep review");
  assert.equal(result.goalId, null);
  assert.equal(
    result.goalError,
    'Goal "MissingGoal" is unavailable for the selected project.',
  );
});

test("goal outside selected project returns clear goal error", () => {
  const result = parseQuickTaskCommand(
    "Prep review /LaunchChecklist",
    projects,
    goals,
    { now: monday, selectedProjectId: "project-2" },
  );

  assert.equal(result.goalId, null);
  assert.equal(
    result.goalError,
    'Goal "LaunchChecklist" is unavailable for the selected project.',
  );
});

test("parses blocked token with reason", () => {
  const result = parseQuickTaskCommand(
    "Draft integration plan @blocked:WaitingOnAPI",
    projects,
    goals,
    { now: monday },
  );

  assert.equal(result.title, "Draft integration plan");
  assert.equal(result.status, "blocked");
  assert.equal(result.blockedReason, "WaitingOnAPI");
  assert.equal(result.blockedError, null);
});

test("blocked token without reason returns blocked error", () => {
  const result = parseQuickTaskCommand(
    "Draft integration plan @blocked:",
    projects,
    goals,
    { now: monday },
  );

  assert.equal(result.title, "Draft integration plan");
  assert.equal(result.status, "blocked");
  assert.equal(result.blockedReason, null);
  assert.equal(result.blockedError, "Blocked reason is required when status is Blocked.");
});

test("parses tomorrow", () => {
  const result = parseQuickTaskCommand("Draft outline tomorrow", projects, { now: monday });

  assert.equal(result.title, "Draft outline");
  assert.equal(result.dueDate, "2026-04-28");
});

test("parses weekday names as next matching day", () => {
  const result = parseQuickTaskCommand("Review launch friday", projects, { now: monday });

  assert.equal(result.title, "Review launch");
  assert.equal(result.dueDate, "2026-05-01");
});

test("keeps unknown words in title", () => {
  const result = parseQuickTaskCommand("Map frobnicate runway someday maybe", projects, {
    now: monday,
  });

  assert.equal(result.title, "Map frobnicate runway someday maybe");
  assert.equal(result.dueDate, null);
  assert.equal(result.priority, null);
  assert.equal(result.estimateMinutes, null);
});

test("keeps unknown non-token words in title around goal and blocked tokens", () => {
  const result = parseQuickTaskCommand(
    "Map frobnicate runway /MissingGoal someday @blocked:Waiting-on-API maybe",
    projects,
    goals,
    { now: monday, selectedProjectId: "project-1" },
  );

  assert.equal(result.title, "Map frobnicate runway someday maybe");
  assert.equal(result.goalError, 'Goal "MissingGoal" is unavailable for the selected project.');
  assert.equal(result.blockedReason, "Waiting-on-API");
});

test("returns no project when command has no project token", () => {
  const result = parseQuickTaskCommand("Plan review today", projects, { now: monday });

  assert.equal(result.projectToken, null);
  assert.equal(result.projectId, null);
  assert.equal(result.projectName, null);
  assert.equal(result.projectError, null);
});

test("unrecognized token-like words do not disappear", () => {
  const result = parseQuickTaskCommand("Fix p9 30q #Nope", projects, { now: monday });

  assert.equal(result.title, "Fix p9 30q");
  assert.equal(result.projectToken, "Nope");
  assert.equal(result.projectError, 'Project "Nope" is unavailable.');
});

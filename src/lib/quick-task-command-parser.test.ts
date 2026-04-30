import assert from "node:assert/strict";
import test from "node:test";

import { parseQuickTaskCommand } from "./quick-task-command-parser";

const projects = [
  { id: "project-1", name: "Execution OS" },
  { id: "project-2", name: "Content Engine" },
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

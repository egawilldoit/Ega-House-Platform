import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const page = readFileSync(
  path.join(process.cwd(), "src", "app", "tasks", "projects", "[slug]", "page.tsx"),
  "utf8",
);

test("project detail due filters use the account local date from Time Context", () => {
  // The Overdue / Due today / Due soon pills must filter with the owner's EGA
  // House local date resolved through the canonical web Time Context seam,
  // never the server/runtime-local day.
  assert.match(page, /getWebTimeContext/);
  assert.match(page, /today: timeContext\?\.localDate/);
  assert.match(
    page,
    /applyTaskListQuery\(\s*activeTasks\.filter\([\s\S]*?\),\s*\{\s*dueFilter: activeDueFilter,\s*sortValue: activeSort,\s*today: timeContext\?\.localDate,\s*\},\s*\)/,
  );
});

test("project overview counts the non-archived scope used by destination lists", () => {
  // Segment counts and the embedded list use the same active archive scope as
  // /tasks?project=.., so a status segment can never disagree with its target.
  assert.match(page, /const activeTasks = allTasks\.filter\(\(task\) => task\.archived_at === null\)/);
  assert.match(page, /buildProjectProgress\(activeTasks\)/);
  assert.match(page, /selectProjectComingUpTasks\(activeTasks/);
  assert.match(page, /applyTaskListQuery\(\s*activeTasks\.filter/);
});

test("project detail keeps archived task time in the time summary", () => {
  assert.match(page, /buildProjectTimeSummary\(allTasks, sessions, weekWindow, nowIso\)/);
});

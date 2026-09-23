import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function read(...segments: string[]) {
  return readFileSync(path.join(process.cwd(), "src", ...segments), "utf8");
}

test("Today hides the Start Here task from Up next without changing queue data", () => {
  const page = read("app", "today", "page.tsx");

  assert.match(page, /tasks=\{todayData\.focusQueue\}/);
  assert.match(page, /excludeTaskId=\{todayData\.startHere\?\.id \?\? null\}/);
});

test("Today keeps the completed-today empty state compact", () => {
  const page = read("app", "today", "page.tsx");

  assert.match(page, /Nothing completed yet today\./);
  assert.doesNotMatch(page, /No completed items yet/);
});

test("Today copy avoids developer vocabulary", () => {
  const page = read("app", "today", "page.tsx");
  const intelligence = read("components", "today", "today-intelligence-panel.tsx");

  assert.doesNotMatch(page, /evidence/i);
  assert.doesNotMatch(intelligence, /evidence/i);
});

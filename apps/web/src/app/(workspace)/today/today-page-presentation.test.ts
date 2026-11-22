import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function read(...segments: string[]) {
  return readFileSync(path.join(process.cwd(), "src", ...segments), "utf8");
}

test("Today hides the Start Here task from Next without changing queue data", () => {
  const page = read("app", "(workspace)", "today", "page.tsx");

  assert.match(page, /tasks=\{nextTasks\}/);
  assert.match(page, /excludeTaskId=\{todayData\.startHere\?\.id \?\? null\}/);
});

test("Today labels the compact queue as Next, not the planned-today lane", () => {
  const panels = read("components", "today", "today-cockpit-panels.tsx");

  assert.match(panels, /title="Next"/);
  assert.doesNotMatch(panels, /title="Up next"/);
});

test("Today collapses dense work into Now, Next, and Done", () => {
  const page = read("app", "(workspace)", "today", "page.tsx");

  assert.match(page, /aria-label="Now"/);
  assert.match(page, /<FocusQueuePanel/);
  assert.match(page, /data-testid="today-also"/);
  assert.match(page, /data-testid="today-done"/);
  assert.match(page, /<details/);
});

test("Today keeps the plan-empty state a compact one-liner, not a chart-sized empty block", () => {
  const page = read("app", "(workspace)", "today", "page.tsx");

  assert.match(page, /Nothing planned yet for today\./);
  assert.doesNotMatch(page, /title="Nothing planned yet for today"/);
});

test("Today keeps the completed-today empty state compact", () => {
  const page = read("app", "(workspace)", "today", "page.tsx");

  assert.match(page, /Nothing completed yet today\./);
  assert.doesNotMatch(page, /No completed items yet/);
});

test("Today mounts the verified timer reconcile for the Now panel's active timer", () => {
  const page = read("app", "(workspace)", "today", "page.tsx");

  // The Now panel's Active Timer is server-rendered; a PWA left open on Today
  // must re-fetch when another device starts or stops the timer.
  assert.match(page, /import \{ TimerSyncStatus \} from "@\/components\/timer\/timer-sync-status";/);
  assert.match(
    page,
    /<TimerSyncStatus surface="today" ownerUserId=\{user\?\.id \?\? null\} \/>/,
  );
  assert.match(page, /<ActiveTimerPanel/);
  // The verified reconcile owns visibility; realtime must not double-refresh.
  assert.match(page, /reconcileOnVisibility=\{false\}/);
});

test("Today no longer eagerly loads health, friction, money or routine cards", () => {
  const page = read("app", "(workspace)", "today", "page.tsx");

  assert.doesNotMatch(page, /getHealthSnapshotData/);
  assert.doesNotMatch(page, /getFrictionRadar/);
  assert.doesNotMatch(page, /loadTodayCards/);
  assert.doesNotMatch(page, /getExpenseSummary/);
  assert.doesNotMatch(page, /TodayWorkCard/);
  assert.doesNotMatch(page, /TodayIntelligencePanel/);
  assert.doesNotMatch(page, /TodayLanePanel/);
});

test("Today surfaces startup and close-day contextually instead of permanently", () => {
  const page = read("app", "(workspace)", "today", "page.tsx");

  assert.match(page, /data-testid="today-startup-disclosure"/);
  assert.match(page, /<MorningStartupPanel model=\{morningStartup\} \/>/);
  assert.match(page, /data-testid="today-finish-day"/);
  assert.match(page, /finishDayRequested/);
  assert.match(page, /<DailyCheckinForm/);
  assert.match(page, /<ShutdownReflectionForm/);
});

test("Today renders the Operator Proposal only for an active plan or an explicit Plan click", () => {
  const page = read("app", "(workspace)", "today", "page.tsx");

  assert.match(page, /const showOperatorPlan = planRequested \|\| Boolean\(activeProposal\);/);
  assert.match(page, /if \(input\.planRequested\) \{/);
  assert.match(page, /data-testid="today-plan-invite"/);
  assert.match(page, /href="\/today\?plan=1#plan"/);
});

test("Today copy avoids developer vocabulary", () => {
  const page = read("app", "(workspace)", "today", "page.tsx");

  assert.doesNotMatch(page, /evidence/i);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  DAYS,
  DEFAULT_PERSONAL_OPERATIONS,
  DEFAULT_USER_PREFERENCES,
  LAUNCH_PAGE_PATHS,
  USER_ACCENT_VALUES,
  USER_DENSITY_VALUES,
  USER_LAUNCH_PAGE_VALUES,
  USER_TASK_LAYOUT_VALUES,
  USER_TASK_OPEN_MODE_VALUES,
  USER_THEME_VALUES,
  getLaunchPagePath,
  getPersonalOperationsDayPlan,
  getPersonalOperationsWeekTotals,
  getUserThemeAttribute,
  normalizeUserPreferences,
  parseUserPreferencesPatch,
} from "../src/preferences";

test("the supported values match the shipped CSS and views", () => {
  assert.deepEqual(USER_THEME_VALUES, ["system", "light", "dark"]);
  assert.deepEqual(USER_ACCENT_VALUES, ["neutral", "blue", "green", "violet", "amber"]);
  assert.deepEqual(USER_DENSITY_VALUES, ["comfortable", "compact"]);
  assert.deepEqual(USER_LAUNCH_PAGE_VALUES, ["home", "today", "tasks"]);
  // Table and Calendar are intentionally absent until those views exist.
  assert.deepEqual(USER_TASK_LAYOUT_VALUES, ["list", "kanban"]);
  assert.deepEqual(USER_TASK_OPEN_MODE_VALUES, ["panel", "full"]);
});

test("defaults preserve the pre-preferences workspace behaviour", () => {
  assert.deepEqual(DEFAULT_USER_PREFERENCES, {
    personalOperations: DEFAULT_USER_PREFERENCES.personalOperations,
    theme: "system",
    accent: "neutral",
    density: "comfortable",
    reducedMotion: false,
    launchPage: "home",
    taskLayout: "list",
    taskOpenMode: "panel",
  });
  assert.equal(Object.isFrozen(DEFAULT_USER_PREFERENCES), true);
});

test("normalizeUserPreferences fills invalid fields per field", () => {
  assert.deepEqual(normalizeUserPreferences(null), DEFAULT_USER_PREFERENCES);
  assert.deepEqual(normalizeUserPreferences("not-a-record"), DEFAULT_USER_PREFERENCES);

  const normalized = normalizeUserPreferences({
    theme: "dark",
    accent: "sepia",
    density: "tiny",
    reducedMotion: "yes",
    launchPage: "calendar",
    taskLayout: "table",
    taskOpenMode: "modal",
  });

  assert.equal(normalized.theme, "dark");
  assert.equal(normalized.accent, "neutral");
  assert.equal(normalized.density, "comfortable");
  assert.equal(normalized.reducedMotion, false);
  assert.equal(normalized.launchPage, "home");
  assert.equal(normalized.taskLayout, "list");
  assert.equal(normalized.taskOpenMode, "panel");
});

test("only supported enum values survive normalization", () => {
  for (const theme of USER_THEME_VALUES) {
    assert.equal(normalizeUserPreferences({ theme }).theme, theme);
  }
  for (const accent of USER_ACCENT_VALUES) {
    assert.equal(normalizeUserPreferences({ accent }).accent, accent);
  }
  for (const density of USER_DENSITY_VALUES) {
    assert.equal(normalizeUserPreferences({ density }).density, density);
  }
  for (const launchPage of USER_LAUNCH_PAGE_VALUES) {
    assert.equal(normalizeUserPreferences({ launchPage }).launchPage, launchPage);
  }
  for (const taskLayout of USER_TASK_LAYOUT_VALUES) {
    assert.equal(normalizeUserPreferences({ taskLayout }).taskLayout, taskLayout);
  }
  for (const taskOpenMode of USER_TASK_OPEN_MODE_VALUES) {
    assert.equal(normalizeUserPreferences({ taskOpenMode }).taskOpenMode, taskOpenMode);
  }
});

test("parseUserPreferencesPatch accepts a valid partial patch", () => {
  const result = parseUserPreferencesPatch({
    theme: "dark",
    reducedMotion: true,
    taskLayout: "kanban",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, {
    theme: "dark",
    reducedMotion: true,
    taskLayout: "kanban",
  });
});

test("parseUserPreferencesPatch ignores unknown keys and absent values", () => {
  const result = parseUserPreferencesPatch({
    theme: "light",
    ownerUserId: "attacker",
    accent: undefined,
    density: null,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, { theme: "light" });
});

test("parseUserPreferencesPatch rejects an unsupported enum instead of coercing it", () => {
  const cases: Array<[string, unknown, string]> = [
    ["theme", "sepia", "Choose Light, Dark or System."],
    ["accent", "red", "Choose a supported accent."],
    ["density", "tiny", "Choose Comfortable or Compact density."],
    ["launchPage", "calendar", "Choose Home, Today or Tasks on launch."],
    ["taskLayout", "table", "Choose List or Kanban as the task layout."],
    ["taskOpenMode", "modal", "Choose Side panel or Full page."],
    ["reducedMotion", "yes", "Reduced motion must be on or off."],
  ];

  for (const [field, value, message] of cases) {
    const result = parseUserPreferencesPatch({ [field]: value });
    assert.equal(result.ok, false, `${field} should be rejected`);
    if (result.ok) continue;
    assert.equal(result.field, field);
    assert.equal(result.message, message);
  }
});

test("launch paths and the default SSR theme attribute are canonical", () => {
  assert.deepEqual(LAUNCH_PAGE_PATHS, {
    home: "/home",
    today: "/today",
    tasks: "/tasks",
  });
  assert.equal(getLaunchPagePath("today"), "/today");
  assert.equal(getUserThemeAttribute("dark"), "dark");
  assert.equal(getUserThemeAttribute("light"), "light");
  // System resolves before paint; the server renders the light baseline.
  assert.equal(getUserThemeAttribute("system"), "light");
});


test("personal schedule defaults and validation", () => {
  const schedule = DEFAULT_USER_PREFERENCES.personalOperations;
  const targets = Object.values(schedule.targets);
  assert.equal(targets.reduce((n, day) => n + day.work, 0), 2880);
  assert.equal(targets.reduce((n, day) => n + day.jobSearch, 0), 450);
  assert.equal(parseUserPreferencesPatch({ personalOperations: schedule }).ok, true);
  assert.equal(parseUserPreferencesPatch({ personalOperations: { ...schedule, targets: { ...schedule.targets, monday: { work: -1, jobSearch: 90 } } } }).ok, false);
  assert.equal(parseUserPreferencesPatch({ personalOperations: { ...schedule, guidance: [...schedule.guidance, schedule.guidance[0]] } }).ok, false);
  assert.deepEqual(normalizeUserPreferences({}).personalOperations, schedule);
});


test("the default schedule is deep-frozen including targets and guidance", () => {
  assert.equal(Object.isFrozen(DEFAULT_PERSONAL_OPERATIONS), true);
  assert.equal(Object.isFrozen(DEFAULT_PERSONAL_OPERATIONS.targets), true);
  assert.equal(Object.isFrozen(DEFAULT_PERSONAL_OPERATIONS.targets.monday), true);
  assert.equal(Object.isFrozen(DEFAULT_PERSONAL_OPERATIONS.guidance), true);
  assert.equal(Object.isFrozen(DEFAULT_PERSONAL_OPERATIONS.guidance[0]), true);
  assert.equal(Object.isFrozen(DEFAULT_PERSONAL_OPERATIONS.guidance[0]?.days), true);
  assert.throws(() => {
    DEFAULT_PERSONAL_OPERATIONS.targets.monday.work = 1;
  }, TypeError);
});

test("normalizeUserPreferences hands out a detached default schedule", () => {
  const first = normalizeUserPreferences({});
  first.personalOperations.targets.monday.work = 1;
  first.personalOperations.guidance[0]!.name = "Mutated";

  const second = normalizeUserPreferences({});
  assert.equal(second.personalOperations.targets.monday.work, 480);
  assert.equal(second.personalOperations.guidance[0]?.name, "Startup");
  assert.equal(DEFAULT_PERSONAL_OPERATIONS.targets.monday.work, 480);
});

test("getPersonalOperationsDayPlan resolves the weekday and targets", () => {
  // 2026-02-16 is a Monday, 2026-02-15 a Sunday.
  const monday = getPersonalOperationsDayPlan(DEFAULT_PERSONAL_OPERATIONS, "2026-02-16");
  assert.equal(monday.ok, true);
  if (!monday.ok) return;
  assert.equal(monday.value.day, "monday");
  assert.equal(monday.value.date, "2026-02-16");
  assert.deepEqual(monday.value.target, { work: 480, jobSearch: 90 });
  assert.equal(monday.value.paused, false);

  for (const [date, day] of [["2026-02-21", "saturday"], ["2026-02-15", "sunday"]] as const) {
    const weekend = getPersonalOperationsDayPlan(DEFAULT_PERSONAL_OPERATIONS, date);
    assert.equal(weekend.ok, true);
    if (!weekend.ok) return;
    assert.equal(weekend.value.day, day);
    assert.deepEqual(weekend.value.target, { work: 240, jobSearch: 0 });
  }
});

test("a paused schedule still reports its full targets", () => {
  const paused = { ...DEFAULT_PERSONAL_OPERATIONS, paused: true };
  const plan = getPersonalOperationsDayPlan(paused, "2026-02-16");
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.value.paused, true);
  assert.deepEqual(plan.value.target, { work: 480, jobSearch: 90 });
  assert.deepEqual(plan.value.guidance.map((block) => block.name), [
    "Startup",
    "Job search",
    "Lunch",
    "Leisure",
  ]);
});

test("day guidance excludes disabled blocks and other weekdays, ordered by start", () => {
  const schedule = {
    ...DEFAULT_PERSONAL_OPERATIONS,
    guidance: [
      { name: "Other day", days: ["tuesday"] as const, start: "08:00", end: "08:30", enabled: true },
      { name: "Disabled", days: ["monday"] as const, start: "09:00", end: "09:30", enabled: false },
      { name: "Late", days: ["monday"] as const, start: "15:00", end: "16:00", enabled: true },
      { name: "Early", days: ["monday"] as const, start: "07:00", end: "07:30", enabled: true },
    ].map((block) => ({ ...block, days: [...block.days] })),
  };
  const plan = getPersonalOperationsDayPlan(schedule, "2026-02-16");
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.value.guidance, [
    { name: "Early", start: "07:00", end: "07:30" },
    { name: "Late", start: "15:00", end: "16:00" },
  ]);
});

test("getPersonalOperationsWeekTotals sums every weekday", () => {
  assert.deepEqual(getPersonalOperationsWeekTotals(DEFAULT_PERSONAL_OPERATIONS), {
    work: 2880,
    jobSearch: 450,
  });
  assert.equal(DAYS.length, 7);
});

test("an invalid local date is rejected with an actionable message", () => {
  for (const candidate of ["", "2026-2-16", "2026-02-30", "16/02/2026", "2026-13-01"]) {
    const plan = getPersonalOperationsDayPlan(DEFAULT_PERSONAL_OPERATIONS, candidate);
    assert.equal(plan.ok, false, `${candidate} should be rejected`);
    if (plan.ok) continue;
    assert.match(plan.message, /Invalid local date: expected YYYY-MM-DD/);
  }
});

test("rejects malformed personal operations without partial acceptance", () => {
  const schedule = DEFAULT_USER_PREFERENCES.personalOperations;
  for (const candidate of [null, [], {}, { ...schedule, extra: true }, { ...schedule, guidance: [{ ...schedule.guidance[0], start: "25:00" }] }, { ...schedule, targets: { ...schedule.targets, monday: { work: 1441, jobSearch: 0 } } }]) {
    assert.equal(parseUserPreferencesPatch({ theme: "dark", personalOperations: candidate }).ok, false);
  }
  assert.equal(parseUserPreferencesPatch(null).ok, false);
});

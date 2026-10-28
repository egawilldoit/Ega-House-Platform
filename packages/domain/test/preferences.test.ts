import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_USER_PREFERENCES,
  LAUNCH_PAGE_PATHS,
  USER_ACCENT_VALUES,
  USER_DENSITY_VALUES,
  USER_LAUNCH_PAGE_VALUES,
  USER_TASK_LAYOUT_VALUES,
  USER_TASK_OPEN_MODE_VALUES,
  USER_THEME_VALUES,
  getLaunchPagePath,
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

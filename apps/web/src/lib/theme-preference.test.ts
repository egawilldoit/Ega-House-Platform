import assert from "node:assert/strict";
import test from "node:test";

import {
  WORKSPACE_THEME_PREFERENCES,
  parseWorkspaceThemePreference,
  resolveWorkspaceTheme,
} from "./theme-preference";

test("accepts only the three supported preferences", () => {
  assert.deepEqual(WORKSPACE_THEME_PREFERENCES, ["system", "light", "dark"]);
  assert.equal(parseWorkspaceThemePreference("light"), "light");
  assert.equal(parseWorkspaceThemePreference("dark"), "dark");
  assert.equal(parseWorkspaceThemePreference("system"), "system");
});

test("missing, invalid, or inaccessible values fall back to system", () => {
  assert.equal(parseWorkspaceThemePreference(null), "system");
  assert.equal(parseWorkspaceThemePreference(undefined), "system");
  assert.equal(parseWorkspaceThemePreference(""), "system");
  assert.equal(parseWorkspaceThemePreference("sepia"), "system");
  assert.equal(parseWorkspaceThemePreference("DARK"), "system");
});

test("explicit choices override the OS while system follows it", () => {
  assert.equal(resolveWorkspaceTheme("light", true), "light");
  assert.equal(resolveWorkspaceTheme("dark", false), "dark");
  assert.equal(resolveWorkspaceTheme("system", true), "dark");
  assert.equal(resolveWorkspaceTheme("system", false), "light");
});

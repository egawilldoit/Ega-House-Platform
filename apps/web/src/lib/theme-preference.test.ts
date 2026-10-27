// @vitest-environment jsdom
import assert from "node:assert/strict";
import test from "node:test";

import {
  WORKSPACE_THEME_INIT_SCRIPT,
  WORKSPACE_THEME_PREFERENCES,
  WORKSPACE_THEME_STORAGE_KEY,
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

test("the pre-paint script applies every preference and OS combination", () => {
  const originalMatchMedia = window.matchMedia;
  const originalTheme = document.documentElement.getAttribute("data-theme");
  const originalPreference = document.documentElement.getAttribute("data-theme-preference");

  try {
    for (const storedValue of [...WORKSPACE_THEME_PREFERENCES, "sepia"]) {
      for (const prefersDark of [false, true]) {
        localStorage.setItem(WORKSPACE_THEME_STORAGE_KEY, storedValue);
        Object.defineProperty(window, "matchMedia", {
          configurable: true,
          writable: true,
          value: () => ({ matches: prefersDark }) as MediaQueryList,
        });

        document.documentElement.removeAttribute("data-theme");
        document.documentElement.removeAttribute("data-theme-preference");
        new Function(WORKSPACE_THEME_INIT_SCRIPT)();

        const expectedPreference = parseWorkspaceThemePreference(storedValue);
        assert.equal(
          document.documentElement.getAttribute("data-theme-preference"),
          expectedPreference,
        );
        assert.equal(
          document.documentElement.getAttribute("data-theme"),
          resolveWorkspaceTheme(expectedPreference, prefersDark),
        );
      }
    }
  } finally {
    localStorage.removeItem(WORKSPACE_THEME_STORAGE_KEY);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
    if (originalTheme === null) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", originalTheme);
    if (originalPreference === null) {
      document.documentElement.removeAttribute("data-theme-preference");
    } else {
      document.documentElement.setAttribute("data-theme-preference", originalPreference);
    }
  }
});

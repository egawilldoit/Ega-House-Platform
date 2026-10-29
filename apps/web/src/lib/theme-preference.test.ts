// @vitest-environment jsdom
import assert from "node:assert/strict";
import test from "node:test";

import {
  WORKSPACE_THEME_ATTRIBUTE,
  WORKSPACE_THEME_INIT_SCRIPT,
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

function installMatchMedia(initialDark: boolean) {
  const originalMatchMedia = window.matchMedia;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: () => ({ matches: initialDark }) as MediaQueryList,
  });
  return () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  };
}

test("the pre-paint script resolves the server preference before paint", () => {
  const root = document.documentElement;
  const originalTheme = root.getAttribute("data-theme");
  const originalPreference = root.getAttribute(WORKSPACE_THEME_ATTRIBUTE);

  try {
    for (const serverPreference of [
      ...WORKSPACE_THEME_PREFERENCES,
      "sepia",
      null,
    ] as const) {
      for (const prefersDark of [false, true]) {
        if (serverPreference === null) root.removeAttribute(WORKSPACE_THEME_ATTRIBUTE);
        else root.setAttribute(WORKSPACE_THEME_ATTRIBUTE, serverPreference);

        const restoreMatchMedia = installMatchMedia(prefersDark);
        root.removeAttribute("data-theme");
        new Function(WORKSPACE_THEME_INIT_SCRIPT)();
        restoreMatchMedia();

        const expectedPreference = parseWorkspaceThemePreference(serverPreference);
        assert.equal(
          root.getAttribute("data-theme"),
          resolveWorkspaceTheme(expectedPreference, prefersDark),
          `server=${String(serverPreference)} osDark=${prefersDark}`,
        );
      }
    }
  } finally {
    if (originalTheme === null) root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", originalTheme);
    if (originalPreference === null) root.removeAttribute(WORKSPACE_THEME_ATTRIBUTE);
    else root.setAttribute(WORKSPACE_THEME_ATTRIBUTE, originalPreference);
  }
});

test("the pre-paint script never reads or writes browser storage", () => {
  const getItem = Storage.prototype.getItem;
  const setItem = Storage.prototype.setItem;
  let storageCalls = 0;

  Storage.prototype.getItem = () => {
    storageCalls += 1;
    throw new Error("storage must not be read for the theme");
  };
  Storage.prototype.setItem = () => {
    storageCalls += 1;
    throw new Error("storage must not be written for the theme");
  };

  try {
    new Function(WORKSPACE_THEME_INIT_SCRIPT)();
    assert.equal(storageCalls, 0);
  } finally {
    Storage.prototype.getItem = getItem;
    Storage.prototype.setItem = setItem;
  }
});

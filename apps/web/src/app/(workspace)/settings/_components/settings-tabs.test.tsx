import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DEFAULT_SETTINGS_TAB,
  SETTINGS_TABS,
  SettingsTabs,
  parseSettingsTab,
} from "./settings-tabs";

test("settings exposes Account, Preferences and Integrations", () => {
  assert.deepEqual(
    SETTINGS_TABS.map((tab) => tab.key),
    ["account", "preferences", "integrations"],
  );
  assert.equal(DEFAULT_SETTINGS_TAB, "account");
});

test("unknown tab values fall back to Account", () => {
  assert.equal(parseSettingsTab("preferences"), "preferences");
  assert.equal(parseSettingsTab("integrations"), "integrations");
  assert.equal(parseSettingsTab("appearance"), "account");
  assert.equal(parseSettingsTab(null), "account");
});

test("renders deep-linkable tabs with one active section", () => {
  const markup = renderToStaticMarkup(<SettingsTabs active="preferences" />);

  assert.match(markup, /href="\/settings\?tab=account"/);
  assert.match(markup, /href="\/settings\?tab=preferences"/);
  assert.match(markup, /href="\/settings\?tab=integrations"/);
  assert.match(markup, /aria-current="page"[^>]*>Preferences</);
  assert.doesNotMatch(markup, /settings\/account/);
});

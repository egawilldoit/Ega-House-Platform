import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AppearanceSettings } from "./appearance-settings";

test("offers Light, Dark and System plus reduced motion", () => {
  const markup = renderToStaticMarkup(
    <AppearanceSettings
      preferences={{ theme: "system", reducedMotion: false }}
      action={() => undefined}
    />,
  );

  for (const value of ["system", "light", "dark"]) {
    assert.match(markup, new RegExp(`name="theme"[^>]*value="${value}"`));
  }
  assert.match(markup, /name="reducedMotion"/);
  assert.doesNotMatch(markup, /name="accent"/);
  assert.doesNotMatch(markup, /name="density"/);
  assert.doesNotMatch(markup, /Accent colour/);
  assert.doesNotMatch(markup, /Sidebar and list density/);
});

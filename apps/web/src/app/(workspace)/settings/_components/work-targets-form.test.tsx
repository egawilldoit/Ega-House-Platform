import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DEFAULT_PERSONAL_OPERATIONS } from "@ega/domain/preferences";

import { WorkTargetsForm } from "./work-targets-form";

test("renders one compact work and job-search target per day", () => {
  const markup = renderToStaticMarkup(
    <WorkTargetsForm
      personalOperations={DEFAULT_PERSONAL_OPERATIONS}
      action={() => undefined}
    />,
  );

  for (const day of ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]) {
    assert.match(markup, new RegExp(`name="work-${day}"`));
    assert.match(markup, new RegExp(`name="jobSearch-${day}"`));
  }

  // Defaults are persisted as minutes, presented as decimal hours.
  assert.match(markup, /name="work-monday"[^>]*value="8"/);
  assert.match(markup, /name="work-saturday"[^>]*value="4"/);
  assert.match(markup, /name="jobSearch-monday"[^>]*value="1.5"/);
  assert.match(markup, /Weekly total/);
  assert.match(markup, /48h/);
  assert.match(markup, /7\.5h/);
  assert.match(markup, /name="paused"/);
});

test("omits the retired schedule-block editor and conflict checker", () => {
  const markup = renderToStaticMarkup(
    <WorkTargetsForm
      personalOperations={DEFAULT_PERSONAL_OPERATIONS}
      action={() => undefined}
    />,
  );

  assert.doesNotMatch(markup, /guidance/i);
  assert.doesNotMatch(markup, /conflict/i);
  assert.doesNotMatch(markup, /Job-search work reference/);
  assert.doesNotMatch(markup, /Save changes/);
});

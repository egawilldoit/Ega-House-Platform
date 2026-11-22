import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DEFAULT_PERSONAL_OPERATIONS } from "@ega/domain/preferences";

import { parseHoursToMinutes } from "@/app/(workspace)/settings/_lib/work-targets";

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

test("a saved 20-minute target stays a valid, round-tripping form value", () => {
  const personalOperations = {
    ...DEFAULT_PERSONAL_OPERATIONS,
    targets: {
      ...DEFAULT_PERSONAL_OPERATIONS.targets,
      monday: { work: 20, jobSearch: 0 },
    },
  };

  const markup = renderToStaticMarkup(
    <WorkTargetsForm personalOperations={personalOperations} action={() => undefined} />,
  );

  // Both hour inputs accept the two-decimal value that 20 minutes renders as;
  // the old step of 0.25 made 0.33 fail native validation and blocked every save.
  const inputSteps = Array.from(markup.matchAll(/step="([^"]+)"/g), (match) => match[1]);
  assert.deepEqual(inputSteps, Array(14).fill("0.01"));

  const renderedValue = markup.match(/name="work-monday"[^>]*value="([^"]+)"/)?.[1];
  assert.equal(renderedValue, "0.33");
  assert.equal(parseHoursToMinutes(renderedValue ?? null), 20);
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

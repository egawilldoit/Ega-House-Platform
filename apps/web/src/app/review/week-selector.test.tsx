import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEEKS_SELECTOR_PATH = resolve(
  import.meta.dirname,
  "./week-selector.tsx",
);

test("week selector renders GET form action=/review with method=get", () => {
  const source = readFileSync(WEEKS_SELECTOR_PATH, "utf-8");

  assert.match(
    source,
    /<form[^>]*action="\/review"[^>]*method="get"[^>]*>/,
    "Week selector should have GET form to /review",
  );
});

test("week selector has date input with name=weekOf for week selection", () => {
  const source = readFileSync(WEEKS_SELECTOR_PATH, "utf-8");

  assert.match(source, /name="weekOf"/, "Should have weekOf input name");
  assert.match(source, /type="date"/, "Should be a date input");
  assert.match(
    source,
    /id="review-week-selector"/,
    "Should have review-week-selector id",
  );
});

test("week selector renders Prev/Next week Link navigation with correct query params", () => {
  const source = readFileSync(WEEKS_SELECTOR_PATH, "utf-8");

  // Previous and Next week are already Link-based navigation (not forms)
  const prevLinkMatch = source.match(/href={`\/review\?weekOf=\$\{previousWeekOf\}`}/);
  assert.ok(prevLinkMatch, "Should have Link to previous week");

  const nextLinkMatch = source.match(/href={`\/review\?weekOf=\$\{nextWeekOf\}`}/);
  assert.ok(nextLinkMatch, "Should have Link to next week");
});

test("week selector shows current week date range and review count", () => {
  const source = readFileSync(WEEKS_SELECTOR_PATH, "utf-8");

  assert.match(
    source,
    /weekStart/,
    "Should reference weekStart for date range",
  );
  assert.match(
    source,
    /weekEnd/,
    "Should reference weekEnd for date range",
  );
  assert.match(
    source,
    /existingReviewCount/,
    "Should reference existingReviewCount for display",
  );
});

test("week selector GET form preserves no-JS fallback behavior", () => {
  const source = readFileSync(WEEKS_SELECTOR_PATH, "utf-8");

  // GET form with action="/review" works without JavaScript
  assert.match(
    source,
    /action="\/review"/,
    "Form action should be /review for server-side navigation",
  );
  assert.match(
    source,
    /method="get"/,
    "GET method enables no-JS query param submission",
  );

  // View Week submit button should be present for no-JS
  assert.match(source, /View week/, "Should have View Week submit button");
});

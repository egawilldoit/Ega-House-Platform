import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const IDEAS_PAGE_PATH = resolve(
  import.meta.dirname,
  "./page.tsx",
);

test("ideas page keeps GET filter form with action=/ideas method=get", () => {
  const source = readFileSync(IDEAS_PAGE_PATH, "utf-8");

  // The ideas filter/search form should remain as GET form (has actual inputs)
  assert.match(
    source,
    /<form[^>]*action="\/ideas"[^>]*method="get"[^>]*>/,
    "Ideas filter form should remain as GET form with action=/ideas",
  );
});

test("ideas page filter form contains search, type, status, project, priority inputs", () => {
  const source = readFileSync(IDEAS_PAGE_PATH, "utf-8");

  assert.match(source, /name="q"/, "Should have search input");
  assert.match(source, /name="type"/, "Should have type select");
  assert.match(source, /name="status"/, "Should have status select");
  assert.match(source, /name="project"/, "Should have project select");
  assert.match(source, /name="priority"/, "Should have priority select");
  assert.match(source, /name="tag"/, "Should have tag input");
});

test("ideas page filter submit uses the canonical pending control", () => {
  const source = readFileSync(IDEAS_PAGE_PATH, "utf-8");

  assert.match(
    source,
    /<PendingSubmitButton[^>]*pendingLabel="Applying…"/,
    "Apply filters should surface an in-flight pending label",
  );
  assert.match(
    source,
    /import \{ PendingSubmitButton \} from "@\/components\/ui\/pending-submit-button"/,
    "Apply filters should use the shared pending submit primitive",
  );
});

test("ideas page uses link-based view switches (All/Inbox/Archived)", () => {
  const source = readFileSync(IDEAS_PAGE_PATH, "utf-8");

  // View switches should be anchors (FilterPill renders a Link when given an
  // href), never form submissions.
  assert.match(
    source,
    /FilterPill[^>]*href=\{getIdeaViewHref\("all/,
    "All view should use a link-based FilterPill",
  );
  assert.match(
    source,
    /FilterPill[^>]*href=\{getIdeaViewHref\("active/,
    "Inbox view should use a link-based FilterPill",
  );
  assert.match(
    source,
    /FilterPill[^>]*href=\{getIdeaViewHref\("archived/,
    "Archived view should use a link-based FilterPill",
  );
  assert.doesNotMatch(
    source,
    /<form[^>]*getIdeaViewHref/,
    "View switches must not be form submissions",
  );
});

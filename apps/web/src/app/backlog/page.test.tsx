import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const BACKLOG_PAGE_PATH = resolve(import.meta.dirname, "./page.tsx");
const IDEAS_PAGE_PATH = resolve(import.meta.dirname, "../ideas/page.tsx");
const BACKLOG_ADD_BUTTON_PATH = resolve(import.meta.dirname, "./backlog-add-button.tsx");

test("EGA-659: canonical /backlog page is the simple Backlog surface, not a triage console", () => {
  const source = readFileSync(BACKLOG_PAGE_PATH, "utf-8");

  assert.match(source, /Backlog/, "page must use Backlog terminology");
  assert.match(source, /Keep ideas here until they are ready to become real work/);
  assert.match(source, /Add to Backlog/);

  // V1 exposes Active and Archived views only — no filter-heavy console.
  assert.match(source, /Active/);
  assert.match(source, /Archived/);
  assert.doesNotMatch(source, /IDEA_NOTE_TYPES/, "no Type filter");
  assert.doesNotMatch(source, /IDEA_NOTE_PRIORITIES/, "no Priority filter");
  assert.doesNotMatch(source, /MANUAL_IDEA_NOTE_STATUSES/, "no manual Status filter");
  assert.doesNotMatch(source, /name="tag"/, "no Tag filter");
  assert.doesNotMatch(source, /name="priority"/, "no Priority filter input");
});

test("EGA-659: /backlog page reuses the canonical idea-note service", () => {
  const source = readFileSync(BACKLOG_PAGE_PATH, "utf-8");
  const actions = readFileSync(resolve(import.meta.dirname, "./actions.ts"), "utf-8");

  assert.match(source, /getIdeaInboxNotes/);
  assert.match(source, /getIdeaNoteProjectOptions/);
  assert.match(actions, /updateIdeaNote/);
  assert.match(actions, /archiveIdeaNote/);
  assert.match(actions, /restoreIdeaNote/);
});

test("EGA-659: /backlog page shows No project for projectless items and notes preview", () => {
  const source = readFileSync(BACKLOG_PAGE_PATH, "utf-8");

  assert.match(source, /No project/);
  assert.match(source, /note\.body/);
  assert.match(source, /note\.projects\?\.name/);
});

test("EGA-659: /backlog page converts via the canonical application operation", () => {
  const actions = readFileSync(resolve(import.meta.dirname, "./actions.ts"), "utf-8");

  assert.match(actions, /convertInboxItemToTask/);
  assert.match(actions, /revalidatePath\("\/tasks"\)/);
  assert.match(actions, /revalidatePath\("\/today"\)/);
  assert.match(actions, /redirect\(`\/tasks#task-\$\{result\.data\.task\.id\}`\)/);
});

test("EGA-659: /ideas becomes a compatibility redirect to /backlog", () => {
  const source = readFileSync(IDEAS_PAGE_PATH, "utf-8");

  assert.match(source, /redirect\(/);
  assert.match(source, /\/backlog/);
  assert.doesNotMatch(source, /getIdeaInboxNotes/, "old page no longer loads the list");
  assert.doesNotMatch(source, /CreateIdeaNoteForm/, "old page no longer renders the capture form");
});

test("EGA-659: /ideas redirect preserves relevant old query parameters", () => {
  const source = readFileSync(IDEAS_PAGE_PATH, "utf-8");

  assert.match(source, /view/);
  assert.match(source, /URLSearchParams/);
});


test("production regression: /backlog keeps click handlers behind a client boundary", () => {
  const pageSource = readFileSync(BACKLOG_PAGE_PATH, "utf-8");
  const buttonSource = readFileSync(BACKLOG_ADD_BUTTON_PATH, "utf-8");

  assert.match(buttonSource, /^"use client";/);
  assert.match(buttonSource, /INBOX_CAPTURE_EVENT/);
  assert.match(buttonSource, /onClick=/);
  assert.match(pageSource, /<BacklogAddButton\s*\/>/);
  assert.doesNotMatch(pageSource, /onClick=/, "the Server Component must not own browser event handlers");
  assert.doesNotMatch(pageSource, /INBOX_CAPTURE_EVENT/);
});

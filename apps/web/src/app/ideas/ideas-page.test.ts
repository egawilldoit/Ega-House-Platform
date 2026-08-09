import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ideasPage = readFileSync(path.join(process.cwd(), "src", "app", "ideas", "page.tsx"), "utf8");
const editForm = readFileSync(
  path.join(process.cwd(), "src", "app", "ideas", "edit-idea-note-form.tsx"),
  "utf8",
);
const archiveControls = readFileSync(
  path.join(process.cwd(), "src", "app", "ideas", "idea-note-archive-controls.tsx"),
  "utf8",
);

test("ideas page renders URL-friendly search and filter controls", () => {
  assert.match(ideasPage, /action="\/ideas"/);
  assert.match(ideasPage, /method="get"/);
  assert.match(ideasPage, /name="q"/);
  assert.match(ideasPage, /name="type"/);
  assert.match(ideasPage, /name="status"/);
  assert.match(ideasPage, /name="project"/);
  assert.match(ideasPage, /name="priority"/);
  assert.match(ideasPage, /name="tag"/);
  assert.match(ideasPage, /Clear filters/);
});

test("manual status UI excludes converted idea status", () => {
  assert.match(editForm, /MANUAL_IDEA_NOTE_STATUSES\.map/);
  assert.doesNotMatch(editForm, /[^A-Z_]IDEA_NOTE_STATUSES/);
  assert.doesNotMatch(editForm, /value="converted"/);
});

test("archive and restore controls render in expected idea views", () => {
  assert.match(ideasPage, /note\.status === "archived"/);
  assert.match(ideasPage, /mode="restore"/);
  assert.match(ideasPage, /mode="archive"/);
  assert.match(archiveControls, /mode === "archive" \? archiveIdeaNoteAction : restoreIdeaNoteAction/);
  assert.match(archiveControls, /mode === "archive" \? "Archive" : "Restore"/);
});

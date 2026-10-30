import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ideasPage = readFileSync(path.join(process.cwd(), "src", "app", "ideas", "page.tsx"), "utf8");
const backlogPage = readFileSync(path.join(process.cwd(), "src", "app", "backlog", "page.tsx"), "utf8");
const backlogActions = readFileSync(path.join(process.cwd(), "src", "app", "backlog", "actions.ts"), "utf8");

test("EGA-659: /ideas compatibility redirect delegates to /backlog", () => {
  assert.match(ideasPage, /redirect\(/);
  assert.match(ideasPage, /\/backlog/);
  assert.doesNotMatch(ideasPage, /getIdeaInboxNotes/);
  assert.doesNotMatch(ideasPage, /CreateIdeaNoteForm/);
  assert.doesNotMatch(ideasPage, /ConvertIdeaNoteForm/);
});

test("EGA-659: active Backlog items convert through the canonical application path", () => {
  assert.match(backlogPage, /BacklogConvertForm/);
  assert.match(backlogPage, /projectOptions=\{projectOptions\}/);
  assert.match(backlogActions, /convertInboxItemToTask/);
  assert.match(backlogActions, /revalidatePath\("\/tasks"\)/);
  assert.match(backlogActions, /redirect\(`\/tasks#task-\$\{result\.data\.task\.id\}`\)/);
});

test("EGA-659: archive and restore controls render in expected Backlog views", () => {
  assert.match(backlogPage, /note\.status === "archived"/);
  assert.match(backlogPage, /mode="restore"/);
  assert.match(backlogPage, /mode="archive"/);
});

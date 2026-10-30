import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const accountPageFile = path.join(
  process.cwd(),
  "src",
  "app",
  "settings",
  "account",
  "page.tsx",
);

test("calendar sync checkbox exposes a separate accessible name and description", () => {
  const source = readFileSync(accountPageFile, "utf8");

  assert.match(source, /id="scheduledTaskSyncEnabled"/);
  assert.match(source, /aria-describedby="scheduledTaskSyncEnabled-help"/);
  assert.match(source, /id="scheduledTaskSyncEnabled-help"/);
  assert.match(source, /htmlFor="scheduledTaskSyncEnabled"/);
  assert.match(source, /Default scheduled tasks to Calendar sync/);
  assert.match(
    source,
    /htmlFor="scheduledTaskSyncEnabled"[\s\S]*?Default scheduled tasks to Calendar sync[\s\S]*?<\/label>/,
  );

});

test("calendar sync checkbox is disabled while Google Calendar is disconnected", () => {
  const source = readFileSync(accountPageFile, "utf8");

  assert.match(source, /disabled=\{!settings\.connected\}/);
  assert.match(source, /Connect Google Calendar to enable\./);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTaskDrawerHref,
  buildTaskDrawerLink,
  readTaskDrawerParam,
} from "./task-drawer-url";

test("reads task and full-page mode independently of view", () => {
  const state = readTaskDrawerParam(
    new URLSearchParams("view=archived&layout=board&task=t1&taskMode=full"),
  );
  assert.deepEqual(state, { taskId: "t1", mode: "full" });
  assert.deepEqual(readTaskDrawerParam(new URLSearchParams("view=archived")), {
    taskId: null,
    mode: "panel",
  });
});

test("opening preserves every unrelated parameter", () => {
  const href = buildTaskDrawerHref(
    "/tasks",
    new URLSearchParams("view=archived&sort=due&tasks=active"),
    { taskId: "t9" },
  );
  const params = new URLSearchParams(href.split("?")[1]);
  assert.equal(params.get("view"), "archived");
  assert.equal(params.get("sort"), "due");
  assert.equal(params.get("tasks"), "active");
  assert.equal(params.get("task"), "t9");
  assert.equal(params.has("taskMode"), false);
});

test("closing removes only the drawer parameters", () => {
  const href = buildTaskDrawerHref(
    "/tasks",
    new URLSearchParams("view=all&task=t9&taskMode=full"),
    { taskId: null },
  );
  assert.equal(href, "/tasks?view=all");
});

test("full mode is dropped when opening in panel mode", () => {
  const href = buildTaskDrawerHref(
    "/tasks",
    new URLSearchParams("task=old&taskMode=full"),
    { taskId: "new" },
  );
  assert.equal(href, "/tasks?task=new");
});

test("server entry points append the selection to their own path", () => {
  assert.equal(buildTaskDrawerLink("/today", "t1"), "/today?task=t1");
  assert.equal(
    buildTaskDrawerLink("/tasks/projects/ship?view=active&sort=due", "t2"),
    "/tasks/projects/ship?view=active&sort=due&task=t2",
  );
});

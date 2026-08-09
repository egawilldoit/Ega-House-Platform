import assert from "node:assert/strict";
import test from "node:test";

import { APPS_LAUNCHER_ITEMS } from "./launcher-items";

test("includes the required workspace modules in launcher config", () => {
  const labels = APPS_LAUNCHER_ITEMS.map((item) => item.label);
  assert.deepEqual(labels, ["Dashboard", "Tasks", "Timer", "Goals", "Review"]);
});

test("maps launcher modules to canonical workspace routes", () => {
  const hrefs = APPS_LAUNCHER_ITEMS.map((item) => item.href);
  assert.deepEqual(hrefs, ["/dashboard", "/tasks", "/timer", "/goals", "/review"]);
});

test("keeps launcher items available and concise", () => {
  APPS_LAUNCHER_ITEMS.forEach((item) => {
    assert.equal(item.available, true);
    assert.ok(item.description.length > 0);
    assert.ok(item.description.length <= 64);
  });
});

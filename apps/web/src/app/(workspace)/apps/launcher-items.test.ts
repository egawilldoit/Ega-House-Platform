import assert from "node:assert/strict";
import test from "node:test";

import { APPS_LAUNCHER_ITEMS } from "./launcher-items";

test("includes the required workspace modules in launcher config", () => {
  const labels = APPS_LAUNCHER_ITEMS.map((item) => item.label);
  assert.deepEqual(labels, ["Home", "Tasks", "Timer", "Goals", "Review"]);
});

test("maps launcher modules to canonical workspace routes", () => {
  const hrefs = APPS_LAUNCHER_ITEMS.map((item) => item.href);
  assert.deepEqual(hrefs, ["/home", "/tasks", "/timer", "/goals", "/review"]);
});

test("opens Home directly instead of the retired /dashboard route", () => {
  // /dashboard only server-redirects to /home, so linking it sends operators
  // through a hop that replaces the history entry (Back then skips the tile).
  const hrefs = APPS_LAUNCHER_ITEMS.map((item) => item.href);
  assert.equal(hrefs.includes("/dashboard"), false);

  const home = APPS_LAUNCHER_ITEMS.find((item) => item.id === "home");
  assert.ok(home);
  assert.equal(home.href, "/home");
  assert.equal(home.icon, "home");
});

test("keeps launcher items available and concise", () => {
  APPS_LAUNCHER_ITEMS.forEach((item) => {
    assert.equal(item.available, true);
    assert.ok(item.description.length > 0);
    assert.ok(item.description.length <= 64);
  });
});

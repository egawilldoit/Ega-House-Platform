import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWorkspaceSections,
  filterNavigationItems,
  flattenPaletteSections,
  nextActiveIndex,
} from "./command-palette-model";

test("navigation items include the full route set when the query is empty", () => {
  const labels = filterNavigationItems("").map((item) => item.label);

  assert.deepEqual(labels, ["Dashboard", "Today", "Tasks", "Goals", "Timer", "Review", "Apps"]);
});

test("filters navigation items case-insensitively and drops non-matches", () => {
  const items = filterNavigationItems("TA");

  assert.deepEqual(items.map((item) => item.label), ["Tasks"]);
});

test("groups search hits into sections with deep-link hrefs", () => {
  const sections = buildWorkspaceSections({
    query: "landing",
    tasks: [{ id: "t1", title: "Ship landing page", status: "todo", projectName: "Web" }],
    projects: [{ id: "p1", name: "Landing", slug: "landing" }],
    goals: [{ id: "g1", title: "Launch landing page" }],
  });

  assert.deepEqual(
    sections.map((section) => section.id),
    ["tasks", "projects", "goals"],
  );
  assert.equal(sections[0].items[0].href, "/tasks#task-t1");
  assert.equal(sections[0].items[0].hint, "Web");
  assert.equal(sections[1].items[0].href, "/tasks/projects/landing");
  assert.equal(sections[2].items[0].href, "/goals");
});

test("projects without a slug fall back to the projects index", () => {
  const sections = buildWorkspaceSections({
    query: "misc",
    tasks: [],
    projects: [{ id: "p9", name: "Misc", slug: null }],
    goals: [],
  });

  assert.equal(sections[0].items[0].href, "/tasks/projects");
});

test("omits empty groups entirely", () => {
  const sections = buildWorkspaceSections({
    query: "x",
    tasks: [],
    projects: [],
    goals: [],
  });

  assert.equal(sections.length, 0);
});

test("flattens sections in order for keyboard traversal", () => {
  const sections = buildWorkspaceSections({
    query: "x",
    tasks: [
      { id: "t1", title: "A", status: "todo", projectName: null },
      { id: "t2", title: "B", status: "todo", projectName: null },
    ],
    projects: [],
    goals: [{ id: "g1", title: "C" }],
  });

  assert.deepEqual(flattenPaletteSections(sections).map((item) => item.label), ["A", "B", "C"]);
});

test("active index wraps in both directions and clamps to valid ranges", () => {
  assert.equal(nextActiveIndex(0, 3, -1), 2);
  assert.equal(nextActiveIndex(2, 3, 1), 0);
  assert.equal(nextActiveIndex(1, 3, 1), 2);
  assert.equal(nextActiveIndex(-1, 3, -1), 2);
  assert.equal(nextActiveIndex(-1, 3, 1), 0);
  assert.equal(nextActiveIndex(0, 0, 1), -1);
});

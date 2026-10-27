import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWorkspaceSections,
  filterNavigationItems,
  filterQuickActionItems,
  flattenPaletteSections,
  highlightMatch,
  nextActiveIndex,
  parseStoredRecents,
  recentEntityFromHref,
  rememberRecent,
  serializeRecents,
  type RecentCommandEntity,
} from "./command-palette-model";

test("navigation items include the full route set when the query is empty", () => {
  const labels = filterNavigationItems("").map((item) => item.label);

  assert.deepEqual(labels, ["Today", "Tasks", "Goals", "Timer", "Review", "Analytics", "Backlog", "Notifications", "Startup", "Shutdown", "Apps", "Help", "Settings"]);
});

test("filters navigation items case-insensitively and drops non-matches", () => {
  const items = filterNavigationItems("TA");

  // With expanded nav, "TA" matches Tasks and Startup (sTArtup)
  assert.deepEqual(items.map((item) => item.label), ["Tasks", "Startup"]);
});

test("groups search hits into sections with deep-link hrefs", () => {
  const sections = buildWorkspaceSections({
    query: "landing",
    scope: "all",
    ideas: [],
    tasks: [{ id: "t1", title: "Ship landing page", status: "todo", projectName: "Web" }],
    projects: [{ id: "p1", name: "Landing", slug: "landing" }],
    goals: [{ id: "g1", title: "Launch landing page" }],
  });

  assert.deepEqual(
    sections.map((section) => section.id),
    ["tasks", "projects", "goals"],
  );
  assert.equal(sections[0].items[0].href, "/tasks?task=t1");
  assert.equal(sections[0].items[0].hint, "Web");
  assert.equal(sections[1].items[0].href, "/tasks/projects/landing");
  assert.equal(sections[2].items[0].href, "/goals");
});

test("projects without a slug fall back to the projects index", () => {
  const sections = buildWorkspaceSections({
    query: "misc",
    scope: "all",
    ideas: [],
    tasks: [],
    projects: [{ id: "p9", name: "Misc", slug: null }],
    goals: [],
  });

  assert.equal(sections[0].items[0].href, "/tasks/projects");
});

test("omits empty groups entirely", () => {
  const sections = buildWorkspaceSections({
    query: "x",
    scope: "all",
    ideas: [],
    tasks: [],
    projects: [],
    goals: [],
  });

  assert.equal(sections.length, 0);
});

test("flattens sections in order for keyboard traversal", () => {
  const sections = buildWorkspaceSections({
    query: "x",
    scope: "all",
    ideas: [],
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

test("quick actions contain creation commands without duplicate navigation", () => {
  const actions = filterQuickActionItems("");
  assert.deepEqual(actions.map(item => item.label), ["Add to Backlog", "New task", "New Project"]);
  const destinations = new Set(filterNavigationItems("").map(item => item.href));
  assert.ok(actions.every(item => item.action || !destinations.has(item.href)));
  assert.ok(actions.every(item => !item.label.startsWith("Open ")));
});

test("highlights every match with text segments instead of HTML", () => {
  assert.deepEqual(highlightMatch("Ship landing landing", "landing"), [
    { text: "Ship ", match: false },
    { text: "landing", match: true },
    { text: " ", match: false },
    { text: "landing", match: true },
  ]);
  assert.deepEqual(highlightMatch("Today", ""), [{ text: "Today", match: false }]);
  assert.deepEqual(highlightMatch("Today", "zzz"), [{ text: "Today", match: false }]);
});

test("recents are ignored when they belong to another owner", () => {
  const stored = serializeRecents(
    [{ id: "t1", kind: "task", label: "Mine", href: "/tasks?task=t1" }],
    "owner-a",
  );

  assert.equal(parseStoredRecents(stored, "owner-a").length, 1);
  // Same browser, different account: never show the previous owner's entities.
  assert.deepEqual(parseStoredRecents(stored, "owner-b"), []);
  assert.deepEqual(parseStoredRecents(stored, null), []);
  assert.deepEqual(parseStoredRecents("not json", "owner-a"), []);
});

test("remembering a recent de-duplicates and keeps the newest eight", () => {
  let recents: RecentCommandEntity[] = [];
  for (let index = 0; index < 10; index += 1) {
    recents = rememberRecent(recents, {
      id: `t${index}`,
      kind: "task",
      label: `Task ${index}`,
      href: `/tasks?task=t${index}`,
    });
  }
  assert.equal(recents.length, 8);
  assert.equal(recents[0].id, "t9");

  recents = rememberRecent(recents, {
    id: "t5",
    kind: "task",
    label: "Task 5 again",
    href: "/tasks?task=t5",
  });
  assert.equal(recents.length, 8);
  assert.equal(recents[0].label, "Task 5 again");
  assert.equal(recents.filter((item) => item.id === "t5").length, 1);
});

test("only entity routes become recents", () => {
  assert.deepEqual(recentEntityFromHref("/tasks?task=t1", "Ship"), {
    id: "t1",
    kind: "task",
    label: "Ship",
    href: "/tasks?task=t1",
  });
  assert.equal(recentEntityFromHref("/tasks/projects/landing", "Landing")?.kind, "project");
  assert.equal(recentEntityFromHref("/today", "Today"), null);
  assert.equal(recentEntityFromHref("/tasks/projects/new", "New project"), null);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const globalsCss = readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");
const tasksPage = readFileSync(path.join(process.cwd(), "src", "app", "tasks", "page.tsx"), "utf8");
const tasksView = (() => {
  try {
    return readFileSync(path.join(process.cwd(), "src", "app", "tasks", "_components", "TasksPageView.tsx"), "utf8");
  } catch {
    return "";
  }
})();
const kanbanCard = readFileSync(
  path.join(process.cwd(), "src", "components", "tasks", "task-kanban-card.tsx"),
  "utf8",
);

test("workspace shell uses a wider controlled content cap with fluid padding", () => {
  assert.match(globalsCss, /\.ega-shell-max\s*\{[\s\S]*?max-width:\s*1760px/);
  assert.match(globalsCss, /\.ega-content\s*\{[\s\S]*?padding:\s*0 clamp\(1rem, 2\.3vw, 3rem\) 3\.5rem/);
  assert.match(
    globalsCss,
    /\.ega-content\.ega-shell-max\s*\{[\s\S]*?max-width:\s*calc\(1840px \+ clamp\(2rem, 4\.6vw, 6rem\)\)/,
  );
});

test("shared workspace rail layout prioritizes main content and stacks below desktop", () => {
  assert.match(
    globalsCss,
    /\.workspace-main-rail-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) clamp\(18rem, 22vw, 23\.5rem\)/,
  );
  assert.match(
    globalsCss,
    /@media \(max-width: 1440px\)\s*\{[\s\S]*?\.workspace-main-rail-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
  );
});

test("tasks kanban board adapts columns to its own container width", () => {
  const tasksSource = tasksPage + tasksView;
  assert.match(tasksSource, /className="tasks-kanban-board"/);
  assert.match(tasksSource, /className="tasks-kanban-column/);
  assert.match(tasksSource, /tasks-board-container/);
  assert.match(
    globalsCss,
    /\.tasks-board-container\s*\{[\s\S]*?container-type:\s*inline-size/,
  );
  assert.match(
    globalsCss,
    /\.tasks-kanban-board\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/,
  );
  assert.match(
    globalsCss,
    /@container \(min-width: 42rem\)\s*\{[\s\S]*?\.tasks-kanban-board\s*\{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    globalsCss,
    /@container \(min-width: 60rem\)\s*\{[\s\S]*?\.tasks-kanban-board\s*\{[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    globalsCss,
    /@container \(min-width: 78rem\)\s*\{[\s\S]*?\.tasks-kanban-board\s*\{[\s\S]*?repeat\(4, minmax\(0, 1fr\)\)/,
  );
});

test("active timer display stacks duration instead of reserving a fixed inner column", () => {
  const activeTimer = readFileSync(
    path.join(process.cwd(), "src", "components", "timer", "active-timer-display.tsx"),
    "utf8",
  );
  assert.match(activeTimer, /className="active-timer-card/);
  assert.match(activeTimer, /className="active-timer-display-grid"/);
  assert.doesNotMatch(activeTimer, /lg:grid-cols-\[minmax\(0,1fr\)_18rem\]/);
  assert.match(
    globalsCss,
    /\.active-timer-display-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/,
  );
  assert.match(
    globalsCss,
    /@container \(min-width: 40rem\)\s*\{[\s\S]*?\.active-timer-display-grid\s*\{[\s\S]*?minmax\(0, 1fr\) 18rem/,
  );
});

test("kanban card action rows use compact responsive wrapping hook", () => {
  assert.match(kanbanCard, /tasks-kanban-card-actions/g);
  assert.match(
    globalsCss,
    /\.tasks-kanban-card-actions > form,\s*\.tasks-kanban-card-actions > details\s*\{[\s\S]*?flex:\s*0 1 auto/,
  );
  assert.match(
    globalsCss,
    /@media \(max-width: 640px\)\s*\{[\s\S]*?\.tasks-kanban-card-actions > form,\s*\.tasks-kanban-card-actions > details\s*\{[\s\S]*?flex:\s*1 1 8\.5rem/,
  );
});

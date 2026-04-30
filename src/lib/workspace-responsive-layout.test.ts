import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const globalsCss = readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");
const tasksPage = readFileSync(path.join(process.cwd(), "src", "app", "tasks", "page.tsx"), "utf8");
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

test("tasks kanban board uses responsive column contract", () => {
  assert.match(tasksPage, /className="tasks-kanban-board"/);
  assert.match(tasksPage, /className="tasks-kanban-column/);
  assert.match(
    globalsCss,
    /\.tasks-kanban-board\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    globalsCss,
    /@media \(max-width: 1180px\)\s*\{[\s\S]*?\.tasks-kanban-board\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    globalsCss,
    /@media \(max-width: 900px\)\s*\{[\s\S]*?\.tasks-kanban-board\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
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

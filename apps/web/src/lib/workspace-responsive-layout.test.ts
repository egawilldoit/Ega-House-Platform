import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (...segments: string[]) =>
  readFileSync(path.join(process.cwd(), "src", ...segments), "utf8");

const workspaceCss = read("styles", "workspace.css");
const tokensCss = read("styles", "tokens.css");

test("workspace shell uses a controlled content cap with responsive gutters", () => {
  assert.match(tokensCss, /--content-max:\s*1600px/);
  assert.match(tokensCss, /--content-gutter:\s*24px/);
  assert.match(
    workspaceCss,
    /\.ega-shell-max\s*\{[\s\S]*?max-width:\s*var\(--content-max\)/,
  );
  assert.match(
    workspaceCss,
    /\.app-page\s*\{[\s\S]*?padding-inline:\s*var\(--content-gutter\)/,
  );
  assert.match(
    tokensCss,
    /@media \(min-width: 1536px\)\s*\{[\s\S]*?--content-gutter:\s*32px/,
  );
});

test("shared workspace rail layout prioritizes main content and stacks below desktop", () => {
  assert.match(
    workspaceCss,
    /\.workspace-main-rail-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) clamp\(16rem, 20vw, 20rem\)/,
  );
  assert.match(
    workspaceCss,
    /@media \(max-width: 1240px\)\s*\{[\s\S]*?\.workspace-main-rail-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/,
  );
});

test("tasks kanban board adapts columns to its own container width", () => {
  assert.match(
    workspaceCss,
    /\.tasks-board-container\s*\{[\s\S]*?container-type:\s*inline-size/,
  );
  assert.match(
    workspaceCss,
    /\.tasks-kanban-board\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/,
  );
  assert.match(
    workspaceCss,
    /@container \(min-width: 42rem\)\s*\{[\s\S]*?\.tasks-kanban-board\s*\{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    workspaceCss,
    /@container \(min-width: 60rem\)\s*\{[\s\S]*?\.tasks-kanban-board\s*\{[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    workspaceCss,
    /@container \(min-width: 78rem\)\s*\{[\s\S]*?\.tasks-kanban-board\s*\{[\s\S]*?repeat\(4, minmax\(0, 1fr\)\)/,
  );
});

test("active timer display stacks duration instead of reserving a fixed inner column", () => {
  const activeTimer = read("components", "timer", "active-timer-display.tsx");
  assert.match(activeTimer, /className="active-timer-card/);
  assert.match(activeTimer, /className="active-timer-display-grid"/);
  assert.doesNotMatch(activeTimer, /lg:grid-cols-\[minmax\(0,1fr\)_18rem\]/);
  assert.match(
    workspaceCss,
    /\.active-timer-display-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/,
  );
  assert.match(
    workspaceCss,
    /@container \(min-width: 40rem\)\s*\{[\s\S]*?\.active-timer-display-grid\s*\{[\s\S]*?minmax\(0, 1fr\) 18rem/,
  );
});

test("kanban card action rows use compact responsive wrapping hook", () => {
  const kanbanCard = read("components", "tasks", "task-kanban-card.tsx");
  assert.match(kanbanCard, /tasks-kanban-card-actions/g);
  assert.match(
    workspaceCss,
    /\.tasks-kanban-card-actions > form,\s*\.tasks-kanban-card-actions > details\s*\{[\s\S]*?flex:\s*0 1 auto/,
  );
  assert.match(
    workspaceCss,
    /@media \(max-width: 640px\)\s*\{[\s\S]*?\.tasks-kanban-card-actions > form,\s*\.tasks-kanban-card-actions > details\s*\{[\s\S]*?flex:\s*1 1 8\.5rem/,
  );
});

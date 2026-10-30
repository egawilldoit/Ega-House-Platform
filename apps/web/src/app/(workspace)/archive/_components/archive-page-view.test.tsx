import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { ArchivePageModel } from "@/app/archive/_lib/archive-page-model";

import { ArchivePageView } from "./ArchivePageView";

const TASK_ID = "123e4567-e89b-12d3-a456-426614174000";

function model(overrides: Partial<ArchivePageModel> = {}): ArchivePageModel {
  return {
    tab: "tasks",
    search: "",
    summary: { tasks: 2, goals: 1, projects: 1 },
    tasks: [],
    goals: [],
    projects: [],
    errorMessage: null,
    notice: null,
    ...overrides,
  };
}

test("archive view renders counted section tabs that preserve the search", () => {
  const markup = renderToStaticMarkup(
    <ArchivePageView model={model({ tab: "goals", search: "ship" })} />,
  );

  assert.match(markup, /Tasks \(2\)/);
  assert.match(markup, /Goals \(1\)/);
  assert.match(markup, /Projects \(1\)/);
  assert.match(markup, /href="\/archive\?q=ship"/);
  assert.match(markup, /href="\/archive\?tab=projects&amp;q=ship"/);
  assert.match(markup, /aria-label="Archive sections"/);
  assert.match(markup, /aria-current="page"/);
});

test("archive view lists archived tasks with restore controls and parent context", () => {
  const markup = renderToStaticMarkup(
    <ArchivePageView
      model={model({
        tasks: [
          {
            id: TASK_ID,
            title: "Ship archive centre",
            status: "in_progress",
            priority: "high",
            projectId: "project-1",
            projectName: "Platform",
            projectSlug: "platform",
            projectArchived: false,
            goalId: "goal-1",
            goalTitle: "Q2",
            goalArchived: true,
            archivedAt: "2026-05-02T10:00:00.000Z",
            updatedAt: "2026-05-02T10:00:00.000Z",
          },
        ],
      })}
    />,
  );

  assert.match(markup, /Ship archive centre/);
  assert.match(markup, /Platform · Goal: Q2/);
  assert.match(markup, /In Progress|In progress/);
  assert.match(markup, /Archived/);
  assert.match(
    markup,
    /Stays hidden from active lists until its goal is restored\./,
  );
  assert.match(markup, /name="entity" value="tasks"/);
  assert.match(markup, new RegExp(`name="id" value="${TASK_ID}"`));
  assert.match(markup, /name="returnTo" value="\/archive"/);
  assert.match(markup, /aria-label="Restore Ship archive centre"/);
});

test("archive view shows the empty state and clears the search", () => {
  const empty = renderToStaticMarkup(
    <ArchivePageView model={model({ tab: "projects" })} />,
  );
  assert.match(empty, /No archived projects/);

  const searched = renderToStaticMarkup(
    <ArchivePageView model={model({ tab: "tasks", search: "nothing" })} />,
  );
  assert.match(searched, /No matches in the archive/);
  assert.match(searched, /Try a different title\./);
  assert.match(searched, /href="\/archive"/);
  assert.match(searched, /Clear search/);
});

test("archive view reports errors, notices and keeps permanent delete out", () => {
  const markup = renderToStaticMarkup(
    <ArchivePageView
      model={model({
        errorMessage: "Stop the active timer before archiving this task.",
        notice: "Restored to the active workspace.",
      })}
    />,
  );

  assert.match(markup, /role="alert"/);
  assert.match(markup, /Stop the active timer before archiving this task\./);
  assert.match(markup, /role="status"/);
  assert.match(markup, /Restored to the active workspace\./);
  assert.match(markup, /Permanent\s+deletion is not available in the archive centre/);
  assert.doesNotMatch(markup, /Delete permanently/);
  assert.doesNotMatch(markup, /Purge project/);
});

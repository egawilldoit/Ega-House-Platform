import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { ProjectGoalRecord } from "@ega/application";

import { GoalsPageView } from "@/app/(workspace)/goals/_components/GoalsPageView";
import type { GoalsPageModel } from "@/app/(workspace)/goals/_lib/goals-page-model";

import { ProjectGoalsMilestones } from "./project-goals-milestones";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const milestoneGoal: ProjectGoalRecord = {
  id: "goal-1",
  title: "Ship the light workspace",
  projectId: "project-1",
  health: "on_track",
  nextStep: "Migrate the projects directory.",
};

function milestoneHref(markup: string): string {
  const match = markup.match(/href="([^"]*\/goals\?[^"]*)"/);
  if (!match) throw new Error("milestone goal link missing");
  return match[1].replaceAll("&amp;", "&");
}

test("a project milestone links to the live goal editor, not a redirect", () => {
  // The /goals route must stay a real page: no /goals redirect may shadow it.
  const nextConfig = read("next.config.ts");
  assert.doesNotMatch(nextConfig, /source:\s*"\/goals"/);
  assert.doesNotMatch(nextConfig, /source:\s*"\/goals\/:path\*"/);
  assert.ok(
    existsSync(resolve(process.cwd(), "src/app/(workspace)/goals/page.tsx")),
    "the /goals page route must exist",
  );
  assert.match(read("src/app/(workspace)/goals/page.tsx"), /export default async function GoalsPage/);

  // The milestone renders a deep link that carries the goal view and anchor.
  const markup = renderToStaticMarkup(<ProjectGoalsMilestones goals={[milestoneGoal]} />);
  const href = milestoneHref(markup);
  const url = new URL(href, "https://ega.test");
  assert.equal(url.pathname, "/goals");
  assert.equal(url.searchParams.get("view"), "all");
  assert.equal(url.searchParams.get("goal"), milestoneGoal.id);
  assert.equal(url.hash, `#goal-${milestoneGoal.id}`);
});

test("the milestone deep link target opens the goal editor for that goal", () => {
  const markup = renderToStaticMarkup(<ProjectGoalsMilestones goals={[milestoneGoal]} />);
  const url = new URL(milestoneHref(markup), "https://ega.test");

  // Resolve the link exactly as /goals does: view filter, then the goal id.
  const viewGoal = {
    ...milestoneGoal,
    description: "Replace the editorial surface with the workspace system.",
    status: "active",
    updatedAt: "2026-11-22T10:00:00.000Z",
    projectName: "EGA House",
    linkedTasks: [],
    progressPercent: 0,
  };
  const model = {
    activeView: url.searchParams.get("view"),
    projects: [{ id: "project-1", name: "EGA House" }],
    goals: [viewGoal],
    summary: { total: 1, active: 1, completed: 0, archived: 0 },
    focusedGoal: viewGoal,
    goalUpdateError: null,
    goalUpdateGoalId: null,
    goalUpdateField: null,
  } as unknown as GoalsPageModel;

  const view = renderToStaticMarkup(<GoalsPageView model={model} />);

  assert.match(view, new RegExp(`id="${url.hash.slice(1)}"`));
  assert.match(view, /Ship the light workspace/);
  // The focused goal exposes the create/edit/archive controls that replaced the
  // deleted goal-management surface.
  assert.match(view, /name="health"/);
  assert.match(view, /name="status"/);
  assert.match(view, /name="next_step"/);
  assert.match(view, /Archive goal/);
  assert.match(view, /name="title"/);
});

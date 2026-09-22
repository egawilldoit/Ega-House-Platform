import Link from "next/link";
import { ChevronDown, ChevronRight, Target } from "lucide-react";

import { InlineGoalHealthForm } from "@/components/goals/inline-goal-health-form";
import { InlineGoalNextStepForm } from "@/components/goals/inline-goal-next-step-form";
import { InlineGoalStatusForm } from "@/components/goals/inline-goal-status-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterPill } from "@/components/ui/filter-pill";
import { Metric } from "@/components/ui/metric";
import { ProgressBar } from "@/components/ui/progress-bar";
import { isGoalArchivedStatus } from "@/lib/goal-archive";
import { getGoalHealthLabel, getGoalHealthTone } from "@/lib/goal-health";
import { formatTaskToken, getTaskStatusTone } from "@/lib/task-domain";

import { archiveGoalAction, unarchiveGoalAction, updateGoalHealthAction, updateGoalNextStepAction, updateGoalStatusAction } from "../actions";
import { CreateGoalForm } from "../create-goal-form";
import type { GoalsPageModel } from "../_lib/goals-page-model";

const GOAL_VIEWS = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
] as const;

export function GoalsPageView({ model }: { model: GoalsPageModel }) {
  const { activeView, projects, goals, summary, focusedGoal, goalUpdateError, goalUpdateGoalId, goalUpdateField } = model;
  const focusedGoalHealth = focusedGoal?.health ?? null;
  const focusedGoalIsArchived = focusedGoal ? isGoalArchivedStatus(focusedGoal.status) : false;
  const linkedTasks = focusedGoal?.linkedTasks ?? [];
  const completedLinkedTasks = linkedTasks.filter((task) => task.status === "done").length;
  const goalReturnTo = focusedGoal ? `/goals?view=${activeView}&goal=${focusedGoal.id}` : `/goals?view=${activeView}`;
  const archiveError =
    focusedGoal && goalUpdateGoalId === focusedGoal.id && goalUpdateField === "archive"
      ? goalUpdateError
      : null;

  const atRiskGoalCount = goals.filter(
    (goal) => goal.health === "at_risk" || goal.health === "off_track",
  ).length;
  const linkedTaskTotal = goals.reduce((total, goal) => total + goal.linkedTasks.length, 0);
  const linkedTaskDone = goals.reduce(
    (total, goal) =>
      total + goal.linkedTasks.filter((task) => task.status === "done").length,
    0,
  );
  const overallProgress =
    linkedTaskTotal > 0 ? Math.round((linkedTaskDone / linkedTaskTotal) * 100) : null;

  const directory = (
    <div className="flex min-w-0 flex-col gap-4">
      <Card
        label="Directory"
        title="Goals"
        action={
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Goal views">
            {GOAL_VIEWS.map((view) => (
              <FilterPill
                key={view.value}
                label={view.label}
                href={`/goals?view=${view.value}`}
                active={activeView === view.value}
                ariaCurrent={activeView === view.value ? "page" : undefined}
              />
            ))}
          </div>
        }
      >
        {goals.length > 0 ? (
          <ul className="rows">
            {goals.map((goal) => {
              const isSelected = goal.id === focusedGoal?.id;
              const goalHealth = goal.health;

              return (
                <li
                  key={goal.id}
                  className="row"
                  style={
                    isSelected
                      ? {
                          background: "var(--ega-surface-selected)",
                          boxShadow: "inset 2px 0 0 var(--ega-ink)",
                        }
                      : undefined
                  }
                >
                  <Link
                    href={`/goals?view=${activeView}&goal=${goal.id}`}
                    aria-current={isSelected ? "true" : undefined}
                    className="row-main"
                  >
                    <span className="row-title">{goal.title}</span>
                    <span className="row-meta">
                      {goal.projectName ?? "Unassigned project"}
                      {" · "}
                      {goal.linkedTasks.length} linked task
                      {goal.linkedTasks.length === 1 ? "" : "s"}
                      {isGoalArchivedStatus(goal.status) ? " · Archived" : ""}
                    </span>
                  </Link>

                  <div className="hidden w-28 shrink-0 sm:block">
                    <div className="mb-1 text-right text-[length:var(--text-meta)] tabular-nums text-ega-text-secondary">
                      {goal.progressPercent}%
                    </div>
                    <ProgressBar value={goal.progressPercent} />
                  </div>

                  <span className="row-actions">
                    <Badge tone={getTaskStatusTone(goal.status)}>
                      {formatTaskToken(goal.status)}
                    </Badge>
                    <Badge tone={goalHealth ? getGoalHealthTone(goalHealth) : "muted"}>
                      {goalHealth ? getGoalHealthLabel(goalHealth) : "Health not set"}
                    </Badge>
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-[color:var(--ega-text-tertiary)]"
                      aria-hidden="true"
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            icon={Target}
            title={summary.total > 0 ? "No goals in this view" : "No goals yet"}
            description={
              summary.total > 0
                ? "Archived goals are hidden from the default view. Switch to Archived or All to review them."
                : "Create a goal to start tracking progress against a defined outcome."
            }
          />
        )}
      </Card>

      <Card
        label="Create"
        title="New goal"
        action={<Badge tone="muted">{projects.length} project{projects.length === 1 ? "" : "s"}</Badge>}
      >
        <CardContent>
          {projects.length === 0 ? (
            <p className="surface-empty px-4 py-4 text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-ega-text-secondary">
              Create a project first to attach a goal to the workspace.
            </p>
          ) : (
            <CreateGoalForm projects={projects} />
          )}
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="kpi-grid">
        <div className="kpi-card">
          <Metric
            label="Active goals"
            value={summary.active}
            caption={`${summary.total} goals in the workspace`}
          />
        </div>
        <div className="kpi-card">
          <Metric
            label="At health risk"
            value={atRiskGoalCount}
            caption="At risk or off track in this view"
          />
        </div>
        <div className="kpi-card">
          <Metric
            label="Completed"
            value={summary.completed}
            caption={`${summary.archived} archived`}
          />
        </div>
        {overallProgress !== null ? (
          <div className="kpi-card">
            <Metric
              label="Overall progress"
              value={`${overallProgress}%`}
              caption={`${linkedTaskDone}/${linkedTaskTotal} linked tasks done in this view`}
            />
            <ProgressBar value={overallProgress} />
          </div>
        ) : null}
      </div>

      {focusedGoal ? (
        <div className="workspace-split-grid">
          {directory}

          <Card
            id={`goal-${focusedGoal.id}`}
            className="scroll-mt-24"
            label="Goal detail"
            title={focusedGoal.title}
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={getTaskStatusTone(focusedGoal.status)}>
                  {formatTaskToken(focusedGoal.status)}
                </Badge>
                {focusedGoalHealth ? (
                  <Badge tone={getGoalHealthTone(focusedGoalHealth)}>
                    {getGoalHealthLabel(focusedGoalHealth)}
                  </Badge>
                ) : (
                  <Badge tone="muted">Health not set</Badge>
                )}
                {focusedGoalIsArchived ? <Badge tone="warn">Archived</Badge> : null}
              </div>
            }
          >
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <Metric
                  label="Progress"
                  value={`${focusedGoal.progressPercent}%`}
                  caption={`${completedLinkedTasks} of ${linkedTasks.length} linked task${linkedTasks.length === 1 ? "" : "s"} done`}
                />
                <div className="text-right">
                  <p className="glass-label">Updated</p>
                  <p className="text-[length:var(--text-meta-lg)] tabular-nums text-ega-text-secondary">
                    {new Date(focusedGoal.updatedAt).toLocaleDateString("en-US")}
                  </p>
                </div>
              </div>

              <ProgressBar value={focusedGoal.progressPercent} />

              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="glass-label">Project</dt>
                  <dd className="mt-1 text-[length:var(--text-body)] text-ega-text">
                    {focusedGoal.projectName ?? "Unassigned project"}
                  </dd>
                </div>
                <div>
                  <dt className="glass-label">Health</dt>
                  <dd className="mt-1 text-[length:var(--text-body)] text-ega-text">
                    {focusedGoalHealth ? getGoalHealthLabel(focusedGoalHealth) : "Not set"}
                  </dd>
                </div>
              </dl>

              <p className="text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-ega-text-secondary">
                {focusedGoal.description?.trim() ||
                  "This goal does not have an extended description yet."}
              </p>

              {focusedGoal.nextStep?.trim() ? (
                <div>
                  <p className="glass-label">Next step</p>
                  <p className="mt-1 text-[length:var(--text-body)] leading-[var(--leading-snug)] text-ega-text">
                    {focusedGoal.nextStep.trim()}
                  </p>
                </div>
              ) : null}

              <div className="flex flex-col gap-2 border-t border-[var(--ega-divider)] pt-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="glass-label">Linked tasks</p>
                  <Badge tone="muted">{linkedTasks.length}</Badge>
                </div>

                {linkedTasks.length > 0 ? (
                  <ul className="rows">
                    {linkedTasks.map((task) => (
                      <li key={task.id} className="row px-0!">
                        <Link
                          href={`/tasks?goal=${focusedGoal.id}#task-${task.id}`}
                          className="row-main"
                        >
                          <span className="row-title">{task.title}</span>
                        </Link>
                        <span className="row-actions">
                          <Badge tone={getTaskStatusTone(task.status)}>
                            {formatTaskToken(task.status)}
                          </Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-ega-text-secondary">
                    No linked tasks are attached to this goal yet.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-start gap-2 border-t border-[var(--ega-divider)] pt-4">
                <InlineGoalHealthForm
                  action={updateGoalHealthAction}
                  goalId={focusedGoal.id}
                  returnTo={goalReturnTo}
                  defaultHealth={focusedGoal.health}
                  error={
                    goalUpdateGoalId === focusedGoal.id && goalUpdateField === "health"
                      ? goalUpdateError
                      : null
                  }
                />
                {!focusedGoalIsArchived ? (
                  <InlineGoalStatusForm
                    action={updateGoalStatusAction}
                    goalId={focusedGoal.id}
                    returnTo={goalReturnTo}
                    defaultStatus={focusedGoal.status}
                    error={
                      goalUpdateGoalId === focusedGoal.id && goalUpdateField === "status"
                        ? goalUpdateError
                        : null
                    }
                  />
                ) : null}
                <InlineGoalNextStepForm
                  action={updateGoalNextStepAction}
                  goalId={focusedGoal.id}
                  returnTo={goalReturnTo}
                  defaultNextStep={focusedGoal.nextStep}
                  error={
                    goalUpdateGoalId === focusedGoal.id && goalUpdateField === "next_step"
                      ? goalUpdateError
                      : null
                  }
                />
                <details className="w-full sm:w-auto" open={Boolean(archiveError)}>
                  <summary className="filter-pill list-none cursor-pointer">
                    <span>{focusedGoalIsArchived ? "Restore goal" : "Archive goal"}</span>
                    <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                  </summary>
                  <form
                    action={focusedGoalIsArchived ? unarchiveGoalAction : archiveGoalAction}
                    className="mt-3 flex flex-col gap-2"
                  >
                    <input type="hidden" name="goalId" value={focusedGoal.id} />
                    <input type="hidden" name="returnTo" value={goalReturnTo} />
                    <Button
                      type="submit"
                      variant={focusedGoalIsArchived ? "secondary" : "danger"}
                      size="sm"
                      className="self-start"
                    >
                      {focusedGoalIsArchived ? "Restore goal" : "Archive goal"}
                    </Button>
                    {archiveError ? (
                      <p role="alert" className="feedback-block feedback-block-error">
                        {archiveError}
                      </p>
                    ) : null}
                  </form>
                </details>
              </div>
            </CardContent>

            <CardFooter>
              <Link
                href="/tasks"
                className="text-[length:var(--text-meta-lg)] font-medium text-ega-text-secondary hover:text-ega-text"
              >
                Browse tasks
              </Link>
            </CardFooter>
          </Card>
        </div>
      ) : (
        <div className="max-w-3xl">{directory}</div>
      )}
    </div>
  );
}

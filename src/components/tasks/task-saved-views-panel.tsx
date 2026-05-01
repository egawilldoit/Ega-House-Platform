import React from "react";
import Link from "next/link";

import {
  createTaskSavedViewAction,
  deleteTaskSavedViewAction,
  updateTaskSavedViewAction,
} from "@/app/tasks/saved-views-actions";
import { buildTaskFilterReturnPath } from "@/components/tasks/task-filter-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterPill } from "@/components/ui/filter-pill";
import { Input } from "@/components/ui/input";
import type { Tables } from "@/lib/supabase/database.types";
import {
  areTaskSavedViewFiltersEqual,
  getTaskSavedViewFiltersFromDefinition,
  normalizeTaskSavedViewDefinition,
  normalizeTaskSavedViewFilters,
  type TaskSavedViewFilters,
} from "@/lib/task-saved-views";
import { formatTaskToken } from "@/lib/task-domain";
import type { TaskLayoutMode } from "@/lib/task-list";
import { Bookmark } from "lucide-react";

type TaskSavedViewRow = Pick<
  Tables<"task_saved_views">,
  | "id"
  | "name"
  | "status"
  | "project_id"
  | "goal_id"
  | "due_filter"
  | "sort_value"
  | "definition_json"
  | "updated_at"
> & { is_default?: boolean };

type TaskSavedViewsPanelProps = {
  currentFilters: TaskSavedViewFilters;
  savedViews: TaskSavedViewRow[];
  activeLayout?: TaskLayoutMode;
  projectOptions: Array<{ id: string; name: string }>;
  goalOptions: Array<{ id: string; title: string }>;
  feedback?: { error?: string | null; success?: string | null };
};

export function buildTaskSavedViewCurrentReturnPath(
  filters: TaskSavedViewFilters,
  activeLayout?: TaskLayoutMode,
) {
  return buildTaskFilterReturnPath("/tasks", {
    status: filters.status,
    project: filters.projectId,
    goal: filters.goalId,
    due: filters.dueFilter,
    sort: filters.sortValue,
    priority: filters.priorityValues.join(","),
    estimateMin: filters.estimateMinMinutes,
    estimateMax: filters.estimateMaxMinutes,
    dueWithin: filters.dueWithinDays,
    activeTasks: filters.activeTasks,
    layout: activeLayout,
  });
}

function getSavedViewFilters(view: TaskSavedViewRow): TaskSavedViewFilters {
  const definition = normalizeTaskSavedViewDefinition(view.definition_json);
  const definitionFilters = getTaskSavedViewFiltersFromDefinition(definition);

  return normalizeTaskSavedViewFilters({
    status: definitionFilters.status ?? view.status,
    projectId: view.project_id,
    goalId: view.goal_id,
    dueFilter: view.due_filter,
    sortValue: view.sort_value,
    activeTasks: definitionFilters.activeTasks,
    priority: definitionFilters.priorityValues,
    estimateMinMinutes: definitionFilters.estimateMinMinutes,
    estimateMaxMinutes: definitionFilters.estimateMaxMinutes,
    dueWithinDays: definitionFilters.dueWithinDays,
  });
}

export function getTaskSavedViewHref(view: TaskSavedViewRow, activeLayout?: TaskLayoutMode) {
  const filters = getSavedViewFilters(view);

  return buildTaskFilterReturnPath("/tasks", {
    status: filters.status,
    project: filters.projectId,
    goal: filters.goalId,
    due: filters.dueFilter,
    sort: filters.sortValue,
    priority: filters.priorityValues.join(","),
    estimateMin: filters.estimateMinMinutes,
    estimateMax: filters.estimateMaxMinutes,
    dueWithin: filters.dueWithinDays,
    activeTasks: filters.activeTasks,
    layout: activeLayout,
  });
}

export function getTaskSavedViewsAllTasksHref(activeLayout?: TaskLayoutMode) {
  return activeLayout === "kanban" ? "/tasks?layout=kanban" : "/tasks";
}

export function canEditTaskSavedView(view: Pick<TaskSavedViewRow, "id" | "is_default">) {
  return view.is_default !== true;
}

function describeSavedView(
  view: TaskSavedViewRow,
  projectOptions: TaskSavedViewsPanelProps["projectOptions"],
  goalOptions: TaskSavedViewsPanelProps["goalOptions"],
) {
  const filters = getSavedViewFilters(view);
  if (filters.activeTasks && filters.priorityValues.length > 0 && filters.estimateMinMinutes) {
    return [
      "Active tasks",
      `Priority ${filters.priorityValues.map(formatTaskToken).join(" or ")}`,
      `Estimate at least ${filters.estimateMinMinutes}m`,
    ].join(" · ");
  }
  if (filters.activeTasks && filters.estimateMaxMinutes) {
    return ["Active tasks", `Estimate ${filters.estimateMaxMinutes}m or less`].join(" · ");
  }
  if (filters.activeTasks && filters.status === "blocked") {
    return ["Active tasks", "Blocked"].join(" · ");
  }
  if (filters.activeTasks && filters.dueWithinDays === 7) {
    return ["Active tasks", "Due today through next 7 days"].join(" · ");
  }

  const parts = [
    view.status ? formatTaskToken(view.status) : "All statuses",
    projectOptions.find((project) => project.id === view.project_id)?.name ??
      (view.project_id ? "Project unavailable" : "All projects"),
    goalOptions.find((goal) => goal.id === view.goal_id)?.title ??
      (view.goal_id ? "Goal unavailable" : "All goals"),
    view.due_filter === "all"
      ? "All due dates"
      : view.due_filter === "overdue"
        ? "Overdue"
        : view.due_filter === "due_today"
          ? "Due today"
          : view.due_filter === "due_soon"
            ? "Due soon"
            : "No due date",
    view.sort_value === "updated_desc"
      ? "Recent first"
      : view.sort_value === "due_date_asc"
        ? "Due soonest"
        : "Due latest",
  ];

  return parts.join(" · ");
}

export function TaskSavedViewsPanel({
  currentFilters,
  savedViews,
  activeLayout,
  projectOptions,
  goalOptions,
  feedback,
}: TaskSavedViewsPanelProps) {
  const currentReturnPath = buildTaskSavedViewCurrentReturnPath(currentFilters, activeLayout);
  const allTasksHref = getTaskSavedViewsAllTasksHref(activeLayout);

  return (
    <Card
      id="saved-views"
      className="ega-glass rounded-[1.35rem]"
    >
      <CardHeader className="gap-3 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-xl">Saved views</CardTitle>
            <CardDescription>
              Save custom filters to instantly return to the views that matter most.
            </CardDescription>
          </div>
          <span className="ega-glass-pill flex h-10 w-10 items-center justify-center rounded-full text-[var(--signal-live)]">
            <Bookmark className="h-4 w-4" aria-hidden="true" />
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-1">
        {feedback?.error ? (
          <div role="alert" className="feedback-block feedback-block-error">{feedback.error}</div>
        ) : null}
        {feedback?.success ? (
          <div className="feedback-block feedback-block-success">{feedback.success}</div>
        ) : null}

        <Badge tone="muted" className="ega-glass-pill">{savedViews.length} saved</Badge>

        <form action={createTaskSavedViewAction} className="ega-glass-soft rounded-[1rem] p-3">
          <input type="hidden" name="returnTo" value={currentReturnPath} />
          <input type="hidden" name="status" value={currentFilters.status ?? ""} />
          <input type="hidden" name="project" value={currentFilters.projectId ?? ""} />
          <input type="hidden" name="goal" value={currentFilters.goalId ?? ""} />
          <input type="hidden" name="due" value={currentFilters.dueFilter} />
          <input type="hidden" name="sort" value={currentFilters.sortValue} />
          <input type="hidden" name="priority" value={currentFilters.priorityValues.join(",")} />
          <input type="hidden" name="estimateMin" value={currentFilters.estimateMinMinutes ?? ""} />
          <input type="hidden" name="estimateMax" value={currentFilters.estimateMaxMinutes ?? ""} />
          <input type="hidden" name="dueWithin" value={currentFilters.dueWithinDays ?? ""} />
          <input type="hidden" name="tasks" value={currentFilters.activeTasks ? "active" : ""} />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="saved-view-name" className="sr-only">Save current filters as</label>
              <Input
                id="saved-view-name"
                name="name"
                maxLength={80}
                placeholder="e.g. Due today · Content"
                className="ega-glass-input h-11 rounded-xl"
              />
            </div>
            <Button type="submit" className="h-11 rounded-xl sm:shrink-0">Save view</Button>
          </div>
        </form>

        {savedViews.length > 0 ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <FilterPill
                href={allTasksHref}
                label="All tasks"
                active={currentReturnPath === allTasksHref}
                ariaCurrent={currentReturnPath === allTasksHref ? "page" : undefined}
              />
              {savedViews.map((view) => {
                const isActive = areTaskSavedViewFiltersEqual(
                  currentFilters,
                  getSavedViewFilters(view),
                );

                return (
                  <FilterPill
                    key={view.id}
                    href={getTaskSavedViewHref(view, activeLayout)}
                    label={view.name}
                    active={isActive}
                    ariaCurrent={isActive ? "page" : undefined}
                  />
                );
              })}
            </div>

            <div className="space-y-3">
              {savedViews.map((view) => (
                <div key={view.id} className="ega-glass-soft rounded-[1rem] p-4 transition-precise hover:border-[rgba(23,123,82,0.16)] hover:bg-[rgba(255,255,255,0.7)]">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-[color:var(--foreground)]">{view.name}</p>
                        <Badge tone="muted" className="ega-glass-pill">Updated {new Date(view.updated_at).toLocaleDateString("en-GB")}</Badge>
                      </div>
                      <p className="mt-2 text-xs leading-6 text-[color:var(--muted-foreground)]">
                        {describeSavedView(view, projectOptions, goalOptions)}
                      </p>
                    </div>
                    <Link href={getTaskSavedViewHref(view, activeLayout)} className="glass-label text-signal-live">Open</Link>
                  </div>

                  {canEditTaskSavedView(view) ? (
                    <div className="mt-4 flex flex-col gap-3 border-t border-[var(--border)] pt-4 xl:flex-row xl:items-end">
                      <form action={updateTaskSavedViewAction} className="flex-1">
                        <input type="hidden" name="viewId" value={view.id} />
                        <input type="hidden" name="returnTo" value={currentReturnPath} />
                        <input type="hidden" name="status" value={currentFilters.status ?? ""} />
                        <input type="hidden" name="project" value={currentFilters.projectId ?? ""} />
                        <input type="hidden" name="goal" value={currentFilters.goalId ?? ""} />
                        <input type="hidden" name="due" value={currentFilters.dueFilter} />
                        <input type="hidden" name="sort" value={currentFilters.sortValue} />
                        <input type="hidden" name="priority" value={currentFilters.priorityValues.join(",")} />
                        <input type="hidden" name="estimateMin" value={currentFilters.estimateMinMinutes ?? ""} />
                        <input type="hidden" name="estimateMax" value={currentFilters.estimateMaxMinutes ?? ""} />
                        <input type="hidden" name="dueWithin" value={currentFilters.dueWithinDays ?? ""} />
                        <input type="hidden" name="tasks" value={currentFilters.activeTasks ? "active" : ""} />
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                          <div className="flex-1 space-y-2">
                            <label htmlFor={`view-name-${view.id}`} className="glass-label text-etch">Name</label>
                            <Input id={`view-name-${view.id}`} name="name" defaultValue={view.name} maxLength={80} className="ega-glass-input h-10 rounded-xl" />
                          </div>
                          <Button type="submit" variant="muted" className="sm:shrink-0">Update to current filters</Button>
                        </div>
                      </form>

                      <form action={deleteTaskSavedViewAction}>
                        <input type="hidden" name="viewId" value={view.id} />
                        <input type="hidden" name="returnTo" value={currentReturnPath} />
                        <Button type="submit" variant="danger">Delete</Button>
                      </form>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState
            icon={Bookmark}
            title="No saved views yet"
            description="Create a saved view to quickly reapply filters."
            className="min-h-40 justify-center"
          />
        )}
      </CardContent>
    </Card>
  );
}

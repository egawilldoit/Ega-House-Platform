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
import { Input } from "@/components/ui/input";
import type { Tables } from "@/lib/supabase/database.types";
import {
  areTaskSavedViewFiltersEqual,
  normalizeTaskSavedViewFilters,
  type TaskSavedViewFilters,
} from "@/lib/task-saved-views";
import { formatTaskToken } from "@/lib/task-domain";

type TaskSavedViewRow = Pick<
  Tables<"task_saved_views">,
  | "id"
  | "name"
  | "status"
  | "project_id"
  | "goal_id"
  | "due_filter"
  | "sort_value"
  | "updated_at"
>;

type TaskSavedViewsPanelProps = {
  currentFilters: TaskSavedViewFilters;
  savedViews: TaskSavedViewRow[];
  projectOptions: Array<{ id: string; name: string }>;
  goalOptions: Array<{ id: string; title: string }>;
  feedback?: { error?: string | null; success?: string | null };
};

function buildCurrentReturnPath(filters: TaskSavedViewFilters) {
  return buildTaskFilterReturnPath("/tasks", {
    status: filters.status,
    project: filters.projectId,
    goal: filters.goalId,
    due: filters.dueFilter,
    sort: filters.sortValue,
  });
}

function getSavedViewFilters(view: TaskSavedViewRow): TaskSavedViewFilters {
  return normalizeTaskSavedViewFilters({
    status: view.status,
    projectId: view.project_id,
    goalId: view.goal_id,
    dueFilter: view.due_filter,
    sortValue: view.sort_value,
  });
}

function getSavedViewHref(view: TaskSavedViewRow) {
  const filters = getSavedViewFilters(view);

  return buildTaskFilterReturnPath("/tasks", {
    status: filters.status,
    project: filters.projectId,
    goal: filters.goalId,
    due: filters.dueFilter,
    sort: filters.sortValue,
  });
}

function describeSavedView(
  view: TaskSavedViewRow,
  projectOptions: TaskSavedViewsPanelProps["projectOptions"],
  goalOptions: TaskSavedViewsPanelProps["goalOptions"],
) {
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
  projectOptions,
  goalOptions,
  feedback,
}: TaskSavedViewsPanelProps) {
  const currentReturnPath = buildCurrentReturnPath(currentFilters);

  return (
    <Card id="saved-views" className="border-[var(--border)] bg-white">
      <CardHeader className="gap-3 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="glass-label text-signal-live">Saved views</p>
            <CardTitle className="mt-2 text-xl">Reusable filter slices</CardTitle>
            <CardDescription>
              Save the current queue filters, jump between views, and refresh a view without losing the URL-driven flow.
            </CardDescription>
          </div>
          <Badge tone="muted">{savedViews.length} saved</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {feedback?.error ? (
          <div role="alert" className="feedback-block feedback-block-error">{feedback.error}</div>
        ) : null}
        {feedback?.success ? (
          <div className="feedback-block feedback-block-success">{feedback.success}</div>
        ) : null}

        <form action={createTaskSavedViewAction} className="rounded-[1rem] border border-[var(--border)] bg-[color:var(--instrument)] p-4">
          <input type="hidden" name="returnTo" value={currentReturnPath} />
          <input type="hidden" name="status" value={currentFilters.status ?? ""} />
          <input type="hidden" name="project" value={currentFilters.projectId ?? ""} />
          <input type="hidden" name="goal" value={currentFilters.goalId ?? ""} />
          <input type="hidden" name="due" value={currentFilters.dueFilter} />
          <input type="hidden" name="sort" value={currentFilters.sortValue} />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <label htmlFor="saved-view-name" className="glass-label text-etch">Save current filters as</label>
              <Input id="saved-view-name" name="name" maxLength={80} placeholder="e.g. Due today · Content" className="h-10" />
            </div>
            <Button type="submit" className="sm:shrink-0">Save view</Button>
          </div>
        </form>

        {savedViews.length > 0 ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Link href="/tasks" className={currentReturnPath === "/tasks" ? "filter-pill filter-pill-active" : "filter-pill"}>All tasks</Link>
              {savedViews.map((view) => {
                const isActive = areTaskSavedViewFiltersEqual(
                  currentFilters,
                  getSavedViewFilters(view),
                );

                return (
                  <Link
                    key={view.id}
                    href={getSavedViewHref(view)}
                    aria-current={isActive ? "page" : undefined}
                    className={isActive ? "filter-pill filter-pill-active" : "filter-pill"}
                  >
                    {view.name}
                  </Link>
                );
              })}
            </div>

            <div className="space-y-3">
              {savedViews.map((view) => (
                <div key={view.id} className="rounded-[1rem] border border-[var(--border)] bg-[color:var(--instrument-raised)] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-[color:var(--foreground)]">{view.name}</p>
                        <Badge tone="muted">Updated {new Date(view.updated_at).toLocaleDateString("en-GB")}</Badge>
                      </div>
                      <p className="mt-2 text-xs leading-6 text-[color:var(--muted-foreground)]">
                        {describeSavedView(view, projectOptions, goalOptions)}
                      </p>
                    </div>
                    <Link href={getSavedViewHref(view)} className="glass-label text-signal-live">Open</Link>
                  </div>

                  <div className="mt-4 flex flex-col gap-3 border-t border-[var(--border)] pt-4 xl:flex-row xl:items-end">
                    <form action={updateTaskSavedViewAction} className="flex-1">
                      <input type="hidden" name="viewId" value={view.id} />
                      <input type="hidden" name="returnTo" value={currentReturnPath} />
                      <input type="hidden" name="status" value={currentFilters.status ?? ""} />
                      <input type="hidden" name="project" value={currentFilters.projectId ?? ""} />
                      <input type="hidden" name="goal" value={currentFilters.goalId ?? ""} />
                      <input type="hidden" name="due" value={currentFilters.dueFilter} />
                      <input type="hidden" name="sort" value={currentFilters.sortValue} />
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <div className="flex-1 space-y-2">
                          <label htmlFor={`view-name-${view.id}`} className="glass-label text-etch">Name</label>
                          <Input id={`view-name-${view.id}`} name="name" defaultValue={view.name} maxLength={80} className="h-10" />
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
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="surface-empty px-4 py-4 text-sm leading-6 text-[color:var(--muted-foreground)]">
            No saved views yet. Save the current filters to build reusable task slices.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

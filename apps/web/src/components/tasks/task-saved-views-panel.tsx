import Link from "next/link";

import {
  createTaskSavedViewAction,
  deleteTaskSavedViewAction,
  updateTaskSavedViewAction,
} from "@/app/tasks/saved-views-actions";
import { buildTaskFilterReturnPath } from "@/components/tasks/task-filter-url";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

export function getTaskSavedViewGroups(savedViews: readonly TaskSavedViewRow[]) {
  return {
    defaultViews: savedViews.filter((view) => view.is_default),
    customViews: savedViews.filter((view) => !view.is_default),
  };
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
  const { defaultViews, customViews } = getTaskSavedViewGroups(savedViews);
  const orderedSavedViews = [...defaultViews, ...customViews];
  const renderSavedViewCard = (view: TaskSavedViewRow) => {
    const isEditable = canEditTaskSavedView(view);

    return (
      <div
        key={view.id}
        className="rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[color:var(--ega-surface)] p-3"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[length:var(--text-body)] font-medium text-[color:var(--ega-text)]">
                {view.name}
              </p>
              {isEditable ? (
                <Badge tone="muted">
                  Updated {new Date(view.updated_at).toLocaleDateString("en-GB")}
                </Badge>
              ) : (
                <Badge tone="info">Built-in</Badge>
              )}
            </div>
            <p className="mt-1 text-[length:var(--text-meta)] leading-[var(--leading-snug)] text-[color:var(--ega-text-secondary)]">
              {describeSavedView(view, projectOptions, goalOptions)}
            </p>
          </div>
          <Link
            href={getTaskSavedViewHref(view, activeLayout)}
            className="btn-instrument btn-instrument-muted flex h-7 shrink-0 items-center px-2.5 text-xs"
          >
            Open
          </Link>
        </div>

        {isEditable ? (
          <div className="mt-3 flex flex-col gap-2 border-t border-[var(--ega-divider)] pt-3 xl:flex-row xl:items-end">
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
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-1">
                  <label htmlFor={`view-name-${view.id}`} className="glass-label text-etch">
                    Name
                  </label>
                  <Input
                    id={`view-name-${view.id}`}
                    name="name"
                    defaultValue={view.name}
                    maxLength={80}
                    className="h-8 px-2.5 text-[length:var(--text-meta-lg)]"
                  />
                </div>
                <Button type="submit" variant="muted" size="sm" className="sm:shrink-0">
                  Update to current filters
                </Button>
              </div>
            </form>

            <form action={deleteTaskSavedViewAction}>
              <input type="hidden" name="viewId" value={view.id} />
              <input type="hidden" name="returnTo" value={currentReturnPath} />
              <Button type="submit" variant="danger" size="sm">
                Delete
              </Button>
            </form>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <Card
      id="saved-views"
      title="Saved views"
      action={<Badge tone="muted">{savedViews.length} saved</Badge>}
    >
      <CardContent className="flex flex-col gap-3">
        {feedback?.error ? (
          <div role="alert" className="feedback-block feedback-block-error">
            {feedback.error}
          </div>
        ) : null}
        {feedback?.success ? <div className="feedback-block">{feedback.success}</div> : null}

        <form
          action={createTaskSavedViewAction}
          className="rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[var(--ega-surface-subtle)] p-3"
        >
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

          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="saved-view-name" className="sr-only">
                Save current filters as
              </label>
              <Input
                id="saved-view-name"
                name="name"
                maxLength={80}
                placeholder="e.g. Due today · Content"
                className="h-8 px-2.5 text-[length:var(--text-meta-lg)]"
              />
            </div>
            <Button type="submit" size="sm" className="sm:shrink-0">
              Save view
            </Button>
          </div>
        </form>

        <div className="flex flex-wrap gap-1.5">
          <FilterPill
            href={allTasksHref}
            label="All tasks"
            active={currentReturnPath === allTasksHref}
            ariaCurrent={currentReturnPath === allTasksHref ? "page" : undefined}
          />
          {orderedSavedViews.map((view) => {
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

        {savedViews.length > 0 ? (
          <div className="flex flex-col gap-4">
            {defaultViews.length > 0 ? (
              <section aria-labelledby="default-saved-views-heading" className="flex flex-col gap-2">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3
                      id="default-saved-views-heading"
                      className="text-[length:var(--text-meta-lg)] font-semibold text-[color:var(--ega-text)]"
                    >
                      Default views
                    </h3>
                    <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
                      Ready-made views for common execution modes.
                    </p>
                  </div>
                  <Badge tone="muted">{defaultViews.length} built-in</Badge>
                </div>

                <div className="flex flex-col gap-2">{defaultViews.map(renderSavedViewCard)}</div>
              </section>
            ) : null}

            <section aria-labelledby="custom-saved-views-heading" className="flex flex-col gap-2">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3
                    id="custom-saved-views-heading"
                    className="text-[length:var(--text-meta-lg)] font-semibold text-[color:var(--ega-text)]"
                  >
                    Custom views
                  </h3>
                  <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
                    Saved from your current filters.
                  </p>
                </div>
                <Badge tone="muted">{customViews.length} saved</Badge>
              </div>

              {customViews.length > 0 ? (
                <div className="flex flex-col gap-2">{customViews.map(renderSavedViewCard)}</div>
              ) : (
                <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--ega-border-strong)] bg-[var(--ega-surface-subtle)] p-3 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
                  No custom views yet.
                </div>
              )}
            </section>
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

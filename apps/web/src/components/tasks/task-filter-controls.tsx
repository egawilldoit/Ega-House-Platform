"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { SlidersHorizontal, X } from "lucide-react";

import {
  DEFAULT_TASK_DUE_FILTER,
  DEFAULT_TASK_SORT,
  TASK_DUE_FILTER_VALUES,
  TASK_SORT_VALUES,
  type TaskLayoutMode,
  type TaskDueFilter,
  type TaskSortValue,
} from "@/lib/task-list";
import { TASK_PRIORITY_VALUES, TASK_STATUS_VALUES, formatTaskToken } from "@/lib/task-domain";
import { FilterPill } from "@/components/ui/filter-pill";

import {
  buildActiveTaskFilterChips,
  buildClearTaskFiltersUrl,
  getDueFilterLabel,
  getSortLabel,
  mergeTaskFilterUrl,
  type TaskFilterState,
} from "./task-filter-url";

type TaskFilterControlsProps = {
  basePath: string;
  activeStatus?: string | null;
  activePriority?: string | null;
  activeProjectId?: string | null;
  activeGoalId?: string | null;
  activeDueFilter?: TaskDueFilter;
  activeSort?: TaskSortValue;
  activeView?: string | null;
  activeLayout?: TaskLayoutMode;
  activeEstimateMin?: number | string | null;
  activeEstimateMax?: number | string | null;
  activeDueWithin?: number | string | null;
  activeTasksOnly?: boolean | null;
  projectOptions?: Array<{ id: string; name: string }>;
  goalOptions?: Array<{ id: string; title: string }>;
  includePriority?: boolean;
};

type FilterOption = {
  value: string | null;
  label: string;
};

function FilterPills({
  label,
  options,
  activeValue,
  hrefForValue,
}: {
  label: string;
  options: FilterOption[];
  activeValue: string | null;
  hrefForValue: (value: string | null) => string;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="glass-label text-etch">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const isActive = option.value === activeValue;

          return (
            <FilterPill
              key={`${label}-${option.label}`}
              href={hrefForValue(option.value)}
              label={option.label}
              active={isActive}
              ariaCurrent={isActive ? "page" : undefined}
            />
          );
        })}
      </div>
    </fieldset>
  );
}

export function TaskFilterControls({
  basePath,
  activeStatus = null,
  activePriority = null,
  activeProjectId = null,
  activeGoalId = null,
  activeDueFilter = DEFAULT_TASK_DUE_FILTER,
  activeSort = DEFAULT_TASK_SORT,
  activeView = null,
  activeLayout = "list",
  activeEstimateMin = null,
  activeEstimateMax = null,
  activeDueWithin = null,
  activeTasksOnly = null,
  projectOptions = [],
  goalOptions = [],
  includePriority = false,
}: TaskFilterControlsProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const filterState: TaskFilterState = {
    status: activeStatus,
    priority: activePriority,
    estimateMin: activeEstimateMin,
    estimateMax: activeEstimateMax,
    dueWithin: activeDueWithin,
    activeTasks: activeTasksOnly,
    project: activeProjectId,
    goal: activeGoalId,
    due: activeDueFilter,
    sort: activeSort,
    view: activeView,
    layout: activeLayout,
  };

  const hrefFor = (overrides: TaskFilterState) => mergeTaskFilterUrl(basePath, filterState, overrides);

  const statusOptions: FilterOption[] = [
    { value: null, label: "All" },
    ...TASK_STATUS_VALUES.map((status) => ({ value: status, label: formatTaskToken(status) })),
  ];
  const priorityOptions: FilterOption[] = [
    { value: null, label: "All" },
    ...TASK_PRIORITY_VALUES.map((priority) => ({ value: priority, label: formatTaskToken(priority) })),
  ];
  const projectFilterOptions: FilterOption[] = [
    { value: null, label: "All" },
    ...projectOptions.map((project) => ({ value: project.id, label: project.name })),
  ];
  const goalFilterOptions: FilterOption[] = [
    { value: null, label: "All" },
    ...goalOptions.map((goal) => ({ value: goal.id, label: goal.title })),
  ];
  const dueFilterOptions: FilterOption[] = TASK_DUE_FILTER_VALUES.map((value) => ({
    value,
    label: getDueFilterLabel(value),
  }));
  const sortOptions: FilterOption[] = TASK_SORT_VALUES.map((value) => ({
    value,
    label: getSortLabel(value),
  }));

  const activeChips = buildActiveTaskFilterChips(basePath, filterState, {
    projectName: projectOptions.find((project) => project.id === activeProjectId)?.name ?? null,
    goalTitle: goalOptions.find((goal) => goal.id === activeGoalId)?.title ?? null,
  });
  const clearHref = buildClearTaskFiltersUrl(basePath, filterState);
  const hasActiveFilters = activeChips.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <button
        type="button"
        className="filter-pill"
        data-testid="tasks-filter-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Filters</span>
        {hasActiveFilters ? (
          <span
            className="inline-flex h-4 min-w-4 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--ega-surface-muted)] px-1 text-[length:var(--text-micro)] font-semibold tabular-nums text-[color:var(--ega-text-secondary)]"
            aria-label={`${activeChips.length} active filters`}
          >
            {activeChips.length}
          </span>
        ) : null}
      </button>

      <div
        className="flex min-w-0 flex-wrap items-center gap-1.5"
        data-testid="tasks-active-filters"
        aria-label="Active filters"
      >
        {hasActiveFilters ? (
          <>
            {activeChips.map((chip) => (
              <Link
                key={chip.key}
                href={chip.removeHref}
                className="filter-pill filter-pill-active"
                aria-label={`Remove ${chip.label} filter`}
              >
                <span>{chip.label}</span>
                <X className="h-3 w-3" aria-hidden="true" />
              </Link>
            ))}
            <Link
              href={clearHref}
              className="text-[length:var(--text-meta-lg)] font-medium text-[color:var(--ega-text-secondary)] hover:text-[color:var(--ega-text)] hover:underline"
              data-testid="tasks-filter-clear"
            >
              Clear filters
            </Link>
          </>
        ) : (
          <span className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
            No active filters
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Sort tasks">
        <span className="glass-label text-etch">Sort</span>
        <div className="flex flex-wrap gap-1.5">
          {sortOptions.map((option) => {
            const isActive = option.value === activeSort;
            return (
              <FilterPill
                key={`sort-${option.label}`}
                href={hrefFor({ sort: (option.value as TaskSortValue | null) ?? DEFAULT_TASK_SORT })}
                label={option.label}
                active={isActive}
                ariaCurrent={isActive ? "page" : undefined}
              />
            );
          })}
        </div>
      </div>

      {open ? (
        <div
          id={panelId}
          className="flex w-full basis-full flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[var(--ega-surface-subtle)] p-3"
          role="region"
          aria-label="Task filter options"
        >
          <FilterPills
            label="Status"
            options={statusOptions}
            activeValue={activeStatus}
            hrefForValue={(status) => hrefFor({ status })}
          />
          {projectOptions.length > 0 ? (
            <FilterPills
              label="Project"
              options={projectFilterOptions}
              activeValue={activeProjectId}
              hrefForValue={(project) => hrefFor({ project })}
            />
          ) : null}
          {goalOptions.length > 0 ? (
            <FilterPills
              label="Goal"
              options={goalFilterOptions}
              activeValue={activeGoalId}
              hrefForValue={(goal) => hrefFor({ goal })}
            />
          ) : null}
          {includePriority ? (
            <FilterPills
              label="Priority"
              options={priorityOptions}
              activeValue={activePriority}
              hrefForValue={(priority) => hrefFor({ priority })}
            />
          ) : null}
          <FilterPills
            label="Due date"
            options={dueFilterOptions}
            activeValue={activeDueFilter}
            hrefForValue={(due) => hrefFor({ due: (due as TaskDueFilter | null) ?? DEFAULT_TASK_DUE_FILTER })}
          />
        </div>
      ) : null}
    </div>
  );
}

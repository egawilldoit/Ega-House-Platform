"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Filter,
  Save,
  Search,
  X,
} from "lucide-react";

import {
  DEFAULT_TASK_VIEW_DEFINITION,
  TASK_DUE_BUCKET_GROUP_ORDER,
  TASK_DUE_BUCKET_LABELS,
  TASK_FILTER_FIELD_LABELS,
  TASK_FILTER_OPERATOR_LABELS,
  TASK_GROUP_BY_LABELS,
  TASK_PRIORITY_GROUP_ORDER,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_GROUP_ORDER,
  TASK_STATUS_LABELS,
  TASK_TABLE_DEFAULT_COLUMNS,
  TASK_VISIBLE_SORT_KEYS,
  TASK_VIEW_FILTER_FIELDS,
  TASK_VIEW_GROUP_BY_VALUES,
  TASK_VIEW_MAX_FILTERS,
  TASK_VIEW_SORT_LABELS,
  areTaskTableColumnsEqual,
  getDefaultTaskViewSortDirection,
  getTaskViewFilterOperators,
  toTaskViewSearchPairs,
  type TaskViewDefinition,
  type TaskViewFilter,
  type TaskViewFilterField,
  type TaskViewFilterOperator,
  type TaskViewGroupBy,
  type TaskViewSortKey,
} from "@ega/contracts/common/task-list";
import {
  buildTaskListUrl,
  type TaskBoardOrder,
  type TaskCalendarDateField,
  type TaskCalendarView,
  type TaskDensity,
  type TaskLayoutMode,
} from "@/lib/task-list";
import { Input } from "@/components/ui/input";
import { MenuList } from "@/components/ui/menu-list";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PropertyPill } from "@/components/ui/property-pill";
import { createTaskSavedViewAction } from "@/app/tasks/saved-views-actions";

import {
  buildClearTaskFiltersUrl,
  buildTaskViewFilterChips,
  describeTaskViewFilter,
  type TaskFilterState,
} from "../task-filter-url";

export type TaskViewToolbarSavedView = {
  id: string;
  name: string;
  href: string;
  isBuiltIn?: boolean;
};

type TaskViewToolbarProps = {
  basePath: string;
  view: TaskViewDefinition;
  activeLayout: TaskLayoutMode;
  activeDensity: TaskDensity;
  activeView: string;
  activeBoardOrder?: TaskBoardOrder | null;
  activeCalendarView?: TaskCalendarView;
  activeCalendarDate?: string | null;
  activeCalendarDateField?: TaskCalendarDateField;
  projectOptions?: Array<{ id: string; name: string }>;
  goalOptions?: Array<{ id: string; title: string }>;
  savedViews?: TaskViewToolbarSavedView[];
  feedback?: { error?: string | null; success?: string | null };
};

const FIELD_VALUES: Record<
  Exclude<TaskViewFilterField, "due_within_days" | "estimate">,
  readonly string[]
> = {
  status: TASK_STATUS_GROUP_ORDER,
  priority: TASK_PRIORITY_GROUP_ORDER,
  due_bucket: TASK_DUE_BUCKET_GROUP_ORDER,
  project: [],
  goal: [],
};

function isSingleValueOperator(operator: TaskViewFilterOperator) {
  return operator === "is" || operator === "is_not";
}

function filterStateForUrl(
  view: TaskViewDefinition,
  props: Pick<
    TaskViewToolbarProps,
    | "activeLayout"
    | "activeDensity"
    | "activeView"
    | "activeBoardOrder"
    | "activeCalendarView"
    | "activeCalendarDate"
    | "activeCalendarDateField"
  >,
): TaskFilterState {
  return {
    filters: view.filters,
    group: view.groupBy,
    q: view.search,
    sortKey: view.sort.key,
    sortDirection: view.sort.direction,
    activeTasks: view.activeOnly,
    view: props.activeView,
    layout: props.activeLayout,
    density: props.activeDensity,
    boardOrder: props.activeBoardOrder ?? null,
    columns: view.columns,
    cal: props.activeCalendarView ?? "month",
    date: props.activeCalendarDate ?? null,
    dateField: props.activeCalendarDateField ?? "due",
  };
}

export function TaskViewToolbar({
  basePath,
  view,
  activeLayout,
  activeDensity,
  activeView,
  activeBoardOrder = null,
  activeCalendarView = "month",
  activeCalendarDate = null,
  activeCalendarDateField = "due",
  projectOptions = [],
  goalOptions = [],
  savedViews = [],
  feedback,
}: TaskViewToolbarProps) {
  const router = useRouter();
  const editorId = useId();
  const saveId = useId();
  const [editorOpen, setEditorOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [field, setField] = useState<TaskViewFilterField>("status");
  const [operator, setOperator] = useState<TaskViewFilterOperator>("is");
  const [values, setValues] = useState<string[]>([]);
  const [rangeMin, setRangeMin] = useState("");
  const [rangeMax, setRangeMax] = useState("");
  const [editorError, setEditorError] = useState<string | null>(null);

  const urlState = filterStateForUrl(view, {
    activeLayout,
    activeDensity,
    activeView,
    activeBoardOrder,
    activeCalendarView,
    activeCalendarDate,
    activeCalendarDateField,
  });
  const hrefFor = (overrides: {
    filters?: readonly TaskViewFilter[];
    groupBy?: TaskViewGroupBy;
    search?: string;
    sortKey?: TaskViewSortKey;
    sortDirection?: "asc" | "desc";
  }) =>
    buildTaskListUrlCompat(basePath, {
      ...urlState,
      filters: overrides.filters ?? view.filters,
      group: overrides.groupBy ?? view.groupBy,
      q: overrides.search ?? view.search,
      sortKey: overrides.sortKey ?? view.sort.key,
      sortDirection: overrides.sortDirection ?? view.sort.direction,
    });

  const activeChips = buildTaskViewFilterChips(basePath, view, urlState, {
    projectOptions,
    goalOptions,
  });
  const clearHref = buildClearTaskFiltersUrl(basePath, urlState);
  const filterCount = activeChips.length;

  const valueOptions = (() => {
    if (field === "project") {
      return projectOptions.map((project) => ({ id: project.id, label: project.name }));
    }
    if (field === "goal") {
      return goalOptions.map((goal) => ({ id: goal.id, label: goal.title }));
    }
    if (field === "due_within_days" || field === "estimate") return [];
    return FIELD_VALUES[field].map((value) => ({
      id: value,
      label:
        field === "status"
          ? TASK_STATUS_LABELS[value as keyof typeof TASK_STATUS_LABELS]
          : field === "priority"
            ? TASK_PRIORITY_LABELS[value as keyof typeof TASK_PRIORITY_LABELS]
            : TASK_DUE_BUCKET_LABELS[value as keyof typeof TASK_DUE_BUCKET_LABELS],
    }));
  })();

  const resetEditor = () => {
    setEditingIndex(null);
    setField("status");
    setOperator("is");
    setValues([]);
    setRangeMin("");
    setRangeMax("");
    setEditorError(null);
  };

  const openEditorFor = (index: number) => {
    const filter = view.filters[index];
    if (!filter) return;
    setEditingIndex(index);
    setField(filter.field);
    setOperator(filter.operator);
    setEditorError(null);
    if (filter.field === "estimate") {
      setRangeMin(filter.values[0] ?? "");
      setRangeMax(filter.values[1] ?? "");
      setValues([]);
    } else {
      setValues([...filter.values]);
      setRangeMin("");
      setRangeMax("");
    }
    setEditorOpen(true);
  };

  const applyFilter = () => {
    if (editingIndex === null && view.filters.length >= TASK_VIEW_MAX_FILTERS) {
      setEditorError(`You can stack up to ${TASK_VIEW_MAX_FILTERS} filters.`);
      return;
    }

    let nextValues: string[] = [];
    if (field === "estimate") {
      if (!rangeMin && !rangeMax) {
        setEditorError("Enter at least one estimate bound.");
        return;
      }
      nextValues = [rangeMin, rangeMax];
    } else if (field === "due_within_days") {
      const days = Number(values[0] ?? "");
      if (!Number.isSafeInteger(days) || days <= 0 || days > 365) {
        setEditorError("Due window must be 1–365 days.");
        return;
      }
      nextValues = [String(days)];
    } else {
      nextValues = isSingleValueOperator(operator) ? values.slice(0, 1) : values;
      if (nextValues.length === 0) {
        setEditorError("Choose at least one value.");
        return;
      }
    }

    const filter: TaskViewFilter = { field, operator, values: nextValues };
    const nextFilters =
      editingIndex === null
        ? [...view.filters, filter]
        : view.filters.map((entry, index) => (index === editingIndex ? filter : entry));
    setEditorOpen(false);
    resetEditor();
    router.push(hrefFor({ filters: nextFilters }));
  };

  const searchPairs = toTaskViewSearchPairs({ ...view, search: "" }).filter(
    ([key]) => key !== "q",
  );

  const sortPropertyItems = TASK_VISIBLE_SORT_KEYS.map((key) => ({
    id: key,
    label: TASK_VIEW_SORT_LABELS[key],
  }));
  const groupItems = TASK_VIEW_GROUP_BY_VALUES.map((value) => ({
    id: value,
    label: TASK_GROUP_BY_LABELS[value],
  }));
  const viewItems = [
    {
      id: "all-tasks",
      label: "All tasks",
      description: "No saved filters",
    },
    ...savedViews.map((savedView) => ({
      id: savedView.id,
      label: savedView.name,
      description: savedView.isBuiltIn ? "Built-in view" : undefined,
    })),
  ];
  const activeSavedView = savedViews.find(
    (savedView) => savedView.href === buildCurrentHref(),
  ) ?? null;
  const isDefaultView =
    view.filters.length === 0 &&
    !view.search &&
    view.groupBy === "none" &&
    view.sort.key === "updated" &&
    view.sort.direction === "desc" &&
    !view.activeOnly &&
    areTaskTableColumnsEqual(
      view.columns ?? TASK_TABLE_DEFAULT_COLUMNS,
      TASK_TABLE_DEFAULT_COLUMNS,
    );
  const activeViewId = activeSavedView?.id ?? (isDefaultView ? "all-tasks" : null);

  function buildCurrentHref() {
    return buildTaskListUrlCompat(basePath, urlState);
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <Popover
          open={editorOpen}
          onOpenChange={(open) => {
            setEditorOpen(open);
            if (!open) resetEditor();
          }}
        >
          <PopoverTrigger
            type="button"
            className="filter-pill"
            aria-label={`Filters${filterCount > 0 ? `, ${filterCount} active` : ""}`}
          >
            <Filter className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Filter</span>
            {filterCount > 0 ? (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--ega-surface-muted)] px-1 text-[length:var(--text-micro)] font-semibold tabular-nums">
                {filterCount}
              </span>
            ) : null}
          </PopoverTrigger>
          <PopoverContent className="w-[min(24rem,calc(100vw-1rem))] p-3">
            <div className="flex flex-col gap-3" id={editorId}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[var(--tracking-wide)] text-[color:var(--ega-text-tertiary)]">
                  {editingIndex === null ? "Add filter" : "Edit filter"}
                </p>
                {editingIndex !== null ? (
                  <button
                    type="button"
                    className="text-xs text-[color:var(--ega-text-secondary)] underline"
                    onClick={resetEditor}
                  >
                    Add instead
                  </button>
                ) : null}
              </div>

              <div className="flex flex-col gap-1">
                <span className="form-label">Field</span>
                <MenuList
                  label="Filter field"
                  value={field}
                  items={TASK_VIEW_FILTER_FIELDS.map((value) => ({
                    id: value,
                    label: TASK_FILTER_FIELD_LABELS[value],
                  }))}
                  onSelect={(item) => {
                    const nextField = item.id as TaskViewFilterField;
                    setField(nextField);
                    const nextOperator = getTaskViewFilterOperators(nextField)[0];
                    setOperator(nextOperator);
                    setValues([]);
                    setRangeMin("");
                    setRangeMax("");
                    setEditorError(null);
                  }}
                  className="max-h-40 overflow-y-auto"
                />
              </div>

              <div className="flex flex-col gap-1">
                <span className="form-label">Condition</span>
                <MenuList
                  label="Filter operator"
                  value={operator}
                  items={getTaskViewFilterOperators(field).map((value) => ({
                    id: value,
                    label: TASK_FILTER_OPERATOR_LABELS[value],
                  }))}
                  onSelect={(item) => {
                    const nextOperator = item.id as TaskViewFilterOperator;
                    setOperator(nextOperator);
                    if (isSingleValueOperator(nextOperator)) {
                      setValues((current) => current.slice(0, 1));
                    }
                  }}
                  className="max-h-40 overflow-y-auto"
                />
              </div>

              {field === "estimate" ? (
                <div className="flex items-end gap-2">
                  <label className="flex flex-1 flex-col gap-1 text-xs">
                    Min minutes
                    <Input
                      type="number"
                      min={0}
                      max={1_000_000}
                      value={rangeMin}
                      onChange={(event) => setRangeMin(event.target.value)}
                      className="h-8 px-2"
                    />
                  </label>
                  <label className="flex flex-1 flex-col gap-1 text-xs">
                    Max minutes
                    <Input
                      type="number"
                      min={0}
                      max={1_000_000}
                      value={rangeMax}
                      onChange={(event) => setRangeMax(event.target.value)}
                      className="h-8 px-2"
                    />
                  </label>
                </div>
              ) : field === "due_within_days" ? (
                <label className="flex flex-col gap-1 text-xs">
                  Days from today
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={values[0] ?? ""}
                    onChange={(event) => setValues([event.target.value])}
                    className="h-8 px-2"
                  />
                </label>
              ) : (
                <fieldset className="flex flex-col gap-1">
                  <legend className="form-label">Values</legend>
                  <div className="flex max-h-44 flex-col gap-0.5 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--ega-border)] p-1">
                    {valueOptions.length === 0 ? (
                      <p className="px-1 py-2 text-xs text-[color:var(--ega-text-tertiary)]">
                        No options available.
                      </p>
                    ) : (
                      valueOptions.map((option) => {
                        const checked = values.includes(option.id);
                        return (
                          <label
                            key={option.id}
                            className="flex min-h-8 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-1.5 text-xs text-[color:var(--ega-text)] hover:bg-[var(--ega-surface-subtle)]"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) =>
                                setValues((current) =>
                                  isSingleValueOperator(operator)
                                    ? event.target.checked
                                      ? [option.id]
                                      : []
                                    : event.target.checked
                                      ? [...current.filter((value) => value !== option.id), option.id]
                                      : current.filter((value) => value !== option.id),
                                )
                              }
                              className="size-3.5 accent-[var(--ega-accent)]"
                            />
                            <span className="truncate">{option.label}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </fieldset>
              )}

              {editorError ? (
                <p role="alert" className="text-xs text-[color:var(--status-overdue)]">
                  {editorError}
                </p>
              ) : null}

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="btn-instrument btn-instrument-muted h-8 px-3 text-xs"
                  onClick={() => {
                    setEditorOpen(false);
                    resetEditor();
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-instrument h-8 px-3 text-xs"
                  onClick={applyFilter}
                >
                  {editingIndex === null ? "Add filter" : "Update filter"}
                </button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <div
          className="flex min-w-0 flex-wrap items-center gap-1.5"
          aria-label="Active filters"
          data-testid="tasks-active-filters"
        >
          {activeChips.map((chip) => (
            <span
              key={chip.key}
              className="filter-pill filter-pill-active inline-flex items-center gap-1"
            >
              {chip.filterIndex !== undefined ? (
                <button
                  type="button"
                  className="max-w-[16rem] truncate text-left"
                  onClick={() => openEditorFor(chip.filterIndex!)}
                  aria-label={`Edit filter ${chip.label}`}
                >
                  {chip.label}
                </button>
              ) : (
                <span className="max-w-[16rem] truncate">{chip.label}</span>
              )}
              <Link
                href={chip.removeHref}
                aria-label={`Remove ${chip.label} filter`}
                className="-m-1 inline-flex size-6 items-center justify-center rounded-full hover:bg-[var(--ega-surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ega-focus-outline)]"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </Link>
            </span>
          ))}
          {filterCount > 0 ? (
            <Link
              href={clearHref}
              className="text-[length:var(--text-meta-lg)] font-medium text-[color:var(--ega-text-secondary)] hover:text-[color:var(--ega-text)] hover:underline"
            >
              Clear filters
            </Link>
          ) : null}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <PropertyPill
            label="Group by"
            triggerLabel={`Group by: ${TASK_GROUP_BY_LABELS[view.groupBy]}`}
            value={view.groupBy}
            items={groupItems}
            displayValue={`Group: ${TASK_GROUP_BY_LABELS[view.groupBy]}`}
            onSelect={(item) => router.push(hrefFor({ groupBy: item.id as TaskViewGroupBy }))}
          />

          <div className="flex items-center gap-0.5" role="group" aria-label="Sort tasks">
            <PropertyPill
              label="Sort"
              triggerLabel={`Sort by: ${TASK_VIEW_SORT_LABELS[view.sort.key]}`}
              value={view.sort.key}
              items={sortPropertyItems}
              displayValue={`Sort: ${TASK_VIEW_SORT_LABELS[view.sort.key]}`}
              className="rounded-r-none"
              onSelect={(item) => {
                const key = item.id as TaskViewSortKey;
                router.push(
                  hrefFor({
                    sortKey: key,
                    sortDirection:
                      key === view.sort.key
                        ? view.sort.direction
                        : getDefaultTaskViewSortDirection(key),
                  }),
                );
              }}
            />
            <button
              type="button"
              className="inline-flex h-7 items-center rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-1.5 text-[color:var(--ega-text-secondary)] hover:text-[color:var(--ega-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-focus-outline)]"
              aria-label={`Sort direction: ${view.sort.direction === "asc" ? "ascending" : "descending"}`}
              onClick={() =>
                router.push(
                  hrefFor({
                    sortDirection: view.sort.direction === "asc" ? "desc" : "asc",
                  }),
                )
              }
            >
              {view.sort.direction === "asc" ? (
                <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <form action={basePath} method="get" role="search" className="flex min-w-0 items-center gap-1">
          {searchPairs.map(([key, value], index) => (
            <input key={`${key}-${index}`} type="hidden" name={key} value={value} />
          ))}
          <input type="hidden" name="archive" value={activeView === "active" ? "" : activeView} />
          {activeLayout === "kanban" ? <input type="hidden" name="layout" value="kanban" /> : null}
          {activeLayout === "calendar" ? (
            <>
              <input type="hidden" name="layout" value="calendar" />
              {activeCalendarView !== "month" ? (
                <input type="hidden" name="cal" value={activeCalendarView} />
              ) : null}
              {activeCalendarDate ? (
                <input type="hidden" name="date" value={activeCalendarDate} />
              ) : null}
              {activeCalendarDateField !== "due" ? (
                <input type="hidden" name="dateField" value={activeCalendarDateField} />
              ) : null}
            </>
          ) : null}
          {activeDensity === "compact" ? <input type="hidden" name="density" value="compact" /> : null}
          {activeBoardOrder ? (
            <input type="hidden" name="boardOrder" value={activeBoardOrder} />
          ) : null}
          <label htmlFor={`${editorId}-search`} className="sr-only">
            Search tasks by title
          </label>
          <Input
            id={`${editorId}-search`}
            name="q"
            type="search"
            defaultValue={view.search}
            maxLength={120}
            placeholder="Search tasks"
            className="h-8 w-[min(16rem,60vw)] px-2.5 text-xs"
          />
          <button
            type="submit"
            className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--ega-border)] px-2 text-xs text-[color:var(--ega-text-secondary)] hover:text-[color:var(--ega-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-focus-outline)]"
          >
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">Search</span>
          </button>
        </form>
        {view.search ? (
          <Link
            href={hrefFor({ search: "" })}
            className="text-xs font-medium text-[color:var(--ega-text-secondary)] underline"
          >
            Clear search
          </Link>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <PropertyPill
            label="Saved views"
            triggerLabel={
              activeViewId
                ? `Views: ${viewItems.find((item) => item.id === activeViewId)?.label ?? "All tasks"}`
                : "Views: custom view"
            }
            value={activeViewId}
            items={viewItems}
            displayValue="Views"
            onSelect={(item) => {
              if (item.id === "all-tasks") {
                router.push(
                  buildTaskListUrlCompat(basePath, {
                    ...urlState,
                    filters: [],
                    q: "",
                    group: "none",
                    sortKey: DEFAULT_TASK_VIEW_DEFINITION.sort.key,
                    sortDirection: DEFAULT_TASK_VIEW_DEFINITION.sort.direction,
                    activeTasks: false,
                  }),
                );
                return;
              }
              const savedView = savedViews.find((entry) => entry.id === item.id);
              if (savedView) router.push(savedView.href);
            }}
          />

          <Popover open={saveOpen} onOpenChange={setSaveOpen}>
            <PopoverTrigger type="button" className="filter-pill" aria-label="Save current view">
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Save view</span>
            </PopoverTrigger>
            <PopoverContent className="w-[min(20rem,calc(100vw-1rem))] p-3">
              <form action={createTaskSavedViewAction} className="flex flex-col gap-2">
                <input type="hidden" name="returnTo" value={buildCurrentHref()} />
                <input type="hidden" name="definition" value={JSON.stringify(view)} />
                <label htmlFor={saveId} className="form-label">
                  View name
                </label>
                <Input
                  id={saveId}
                  name="name"
                  maxLength={80}
                  required
                  placeholder="e.g. Urgent content this week"
                  className="h-8 px-2.5 text-xs"
                />
                <PendingSubmitButton type="submit" size="sm" pendingLabel="Saving…">
                  Save current view
                </PendingSubmitButton>
              </form>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {feedback?.error ? (
        <div role="alert" className="feedback-block feedback-block-error">
          {feedback.error}
        </div>
      ) : null}
      {feedback?.success ? <div className="feedback-block">{feedback.success}</div> : null}

      <p className="sr-only" aria-live="polite">
        {describeActiveView(view)}
      </p>
    </div>
  );
}

function describeActiveView(view: TaskViewDefinition) {
  const filters = view.filters.map((filter) => describeTaskViewFilter(filter));
  const parts = [
    filters.length > 0 ? `Filters: ${filters.join(" and ")}` : "No filters",
    `Grouped by ${TASK_GROUP_BY_LABELS[view.groupBy]}`,
    `Sorted by ${TASK_VIEW_SORT_LABELS[view.sort.key]} ${view.sort.direction === "asc" ? "ascending" : "descending"}`,
    view.search ? `Search ${view.search}` : null,
  ].filter(Boolean);
  return parts.join(". ");
}

/**
 * Wrapper keeps the toolbar's URL construction on the shared list builder while
 * allowing a readonly canonical definition to flow through unchanged.
 */
function buildTaskListUrlCompat(
  basePath: string,
  filters: TaskFilterState,
): string {
  return buildTaskListUrl(basePath, filters);
}

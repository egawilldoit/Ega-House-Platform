import Link from "next/link";
import {
  DEFAULT_TASK_DUE_FILTER,
  DEFAULT_TASK_SORT,
  TASK_DUE_FILTER_VALUES,
  TASK_SORT_VALUES,
  type TaskDueFilter,
  type TaskSortValue,
} from "@/lib/task-list";
import { cn } from "@/lib/utils";

import {
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  formatTaskToken,
} from "@/lib/task-domain";

type TaskFilterControlsProps = {
  basePath: string;
  activeStatus?: string | null;
  activePriority?: string | null;
  activeProjectId?: string | null;
  activeGoalId?: string | null;
  activeDueFilter?: TaskDueFilter;
  activeSort?: TaskSortValue;
  projectOptions?: Array<{ id: string; name: string }>;
  goalOptions?: Array<{ id: string; title: string }>;
  includePriority?: boolean;
};

type FilterOption = {
  value: string | null;
  label: string;
};

function buildFilterHref(
  basePath: string,
  filters: {
    status?: string | null;
    priority?: string | null;
    project?: string | null;
    goal?: string | null;
    due?: TaskDueFilter;
    sort?: TaskSortValue;
  },
) {
  const searchParams = new URLSearchParams();

  if (filters.status) {
    searchParams.set("status", filters.status);
  }

  if (filters.priority) {
    searchParams.set("priority", filters.priority);
  }

  if (filters.project) {
    searchParams.set("project", filters.project);
  }

  if (filters.goal) {
    searchParams.set("goal", filters.goal);
  }

  if (filters.due && filters.due !== DEFAULT_TASK_DUE_FILTER) {
    searchParams.set("due", filters.due);
  }

  if (filters.sort && filters.sort !== DEFAULT_TASK_SORT) {
    searchParams.set("sort", filters.sort);
  }

  const query = searchParams.toString();
  return query ? `${basePath}?${query}` : basePath;
}

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
    <div className="space-y-2">
      <p className="glass-label text-etch">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isActive = option.value === activeValue;

          return (
            <Link
              key={`${label}-${option.label}`}
              href={hrefForValue(option.value)}
              aria-current={isActive ? "page" : undefined}
              className={cn("filter-pill", isActive && "filter-pill-active")}
            >
              {option.label}
            </Link>
          );
        })}
      </div>
    </div>
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
  projectOptions = [],
  goalOptions = [],
  includePriority = false,
}: TaskFilterControlsProps) {
  const statusOptions: FilterOption[] = [
    { value: null, label: "All" },
    ...TASK_STATUS_VALUES.map((status) => ({
      value: status,
      label: formatTaskToken(status),
    })),
  ];

  const priorityOptions: FilterOption[] = [
    { value: null, label: "All" },
    ...TASK_PRIORITY_VALUES.map((priority) => ({
      value: priority,
      label: formatTaskToken(priority),
    })),
  ];
  const projectFilterOptions: FilterOption[] = [
    { value: null, label: "All" },
    ...projectOptions.map((project) => ({
      value: project.id,
      label: project.name,
    })),
  ];
  const goalFilterOptions: FilterOption[] = [
    { value: null, label: "All" },
    ...goalOptions.map((goal) => ({
      value: goal.id,
      label: goal.title,
    })),
  ];
  const dueFilterOptions: FilterOption[] = TASK_DUE_FILTER_VALUES.map((value) => ({
      value,
      label:
      value === "all"
        ? "All"
        : value === "overdue"
          ? "Overdue"
          : value === "due_today"
            ? "Due today"
          : value === "due_soon"
            ? "Due soon"
            : "No due date",
  }));
  const sortOptions: FilterOption[] = TASK_SORT_VALUES.map((value) => ({
    value,
    label:
      value === "updated_desc"
        ? "Recent"
        : value === "due_date_asc"
          ? "Due soonest"
          : "Due latest",
  }));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <FilterPills
        label="Status"
        options={statusOptions}
        activeValue={activeStatus}
        hrefForValue={(status) =>
          buildFilterHref(basePath, {
            status,
            priority: activePriority,
            project: activeProjectId,
            goal: activeGoalId,
            due: activeDueFilter,
            sort: activeSort,
          })
        }
      />

      {projectOptions.length > 0 ? (
        <FilterPills
          label="Project"
          options={projectFilterOptions}
          activeValue={activeProjectId}
          hrefForValue={(project) =>
            buildFilterHref(basePath, {
              status: activeStatus,
              priority: activePriority,
              project,
              goal: activeGoalId,
              due: activeDueFilter,
              sort: activeSort,
            })
          }
        />
      ) : null}

      {goalOptions.length > 0 ? (
        <div className={cn(includePriority ? "" : "lg:col-span-2")}>
          <FilterPills
            label="Goal"
            options={goalFilterOptions}
            activeValue={activeGoalId}
            hrefForValue={(goal) =>
              buildFilterHref(basePath, {
                status: activeStatus,
                priority: activePriority,
                project: activeProjectId,
                goal,
                due: activeDueFilter,
                sort: activeSort,
              })
            }
          />
        </div>
      ) : null}

      {includePriority ? (
        <FilterPills
          label="Priority"
          options={priorityOptions}
          activeValue={activePriority}
          hrefForValue={(priority) =>
            buildFilterHref(basePath, {
              status: activeStatus,
              priority,
              project: activeProjectId,
              goal: activeGoalId,
              due: activeDueFilter,
              sort: activeSort,
            })
          }
        />
      ) : null}

      <FilterPills
        label="Due date"
        options={dueFilterOptions}
        activeValue={activeDueFilter}
        hrefForValue={(due) =>
          buildFilterHref(basePath, {
            status: activeStatus,
            priority: activePriority,
            project: activeProjectId,
            goal: activeGoalId,
            due: (due as TaskDueFilter | null) ?? DEFAULT_TASK_DUE_FILTER,
            sort: activeSort,
          })
        }
      />

      <FilterPills
        label="Sort"
        options={sortOptions}
        activeValue={activeSort}
        hrefForValue={(sort) =>
          buildFilterHref(basePath, {
            status: activeStatus,
            priority: activePriority,
            project: activeProjectId,
            goal: activeGoalId,
            due: activeDueFilter,
            sort: (sort as TaskSortValue | null) ?? DEFAULT_TASK_SORT,
          })
        }
      />
    </div>
  );
}

export function buildTaskFilterReturnPath(
  basePath: string,
  filters: {
    status?: string | null;
    priority?: string | null;
    project?: string | null;
    goal?: string | null;
    due?: TaskDueFilter;
    sort?: TaskSortValue;
  },
) {
  return buildFilterHref(basePath, filters);
}

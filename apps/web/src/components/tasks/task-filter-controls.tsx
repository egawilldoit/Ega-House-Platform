import {
  DEFAULT_TASK_DUE_FILTER,
  DEFAULT_TASK_SORT,
  TASK_DUE_FILTER_VALUES,
  TASK_SORT_VALUES,
  buildTaskListUrl,
  type TaskLayoutMode,
  type TaskDueFilter,
  type TaskSortValue,
} from "@/lib/task-list";
import { cn } from "@/lib/utils";

import {
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  formatTaskToken,
} from "@/lib/task-domain";
import { FilterPill } from "@/components/ui/filter-pill";

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
    <div className="space-y-2">
      <p className="glass-label text-etch">{label}</p>
      <div className="flex flex-wrap gap-2">
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
  activeView = null,
  activeLayout = "list",
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
    <div className="flex flex-wrap gap-x-8 gap-y-4">
      <FilterPills
        label="Status"
        options={statusOptions}
        activeValue={activeStatus}
        hrefForValue={(status) =>
          buildTaskListUrl(basePath, {
            status,
            priority: activePriority,
            project: activeProjectId,
            goal: activeGoalId,
            due: activeDueFilter,
            sort: activeSort,
            view: activeView,
            layout: activeLayout,
          })
        }
      />

      {projectOptions.length > 0 ? (
        <FilterPills
          label="Project"
          options={projectFilterOptions}
          activeValue={activeProjectId}
          hrefForValue={(project) =>
            buildTaskListUrl(basePath, {
              status: activeStatus,
              priority: activePriority,
              project,
              goal: activeGoalId,
              due: activeDueFilter,
              sort: activeSort,
              view: activeView,
              layout: activeLayout,
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
              buildTaskListUrl(basePath, {
                status: activeStatus,
                priority: activePriority,
                project: activeProjectId,
                goal,
                due: activeDueFilter,
                sort: activeSort,
                view: activeView,
                layout: activeLayout,
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
            buildTaskListUrl(basePath, {
              status: activeStatus,
              priority,
              project: activeProjectId,
              goal: activeGoalId,
              due: activeDueFilter,
              sort: activeSort,
              view: activeView,
              layout: activeLayout,
            })
          }
        />
      ) : null}

      <FilterPills
        label="Due date"
        options={dueFilterOptions}
        activeValue={activeDueFilter}
        hrefForValue={(due) =>
          buildTaskListUrl(basePath, {
            status: activeStatus,
            priority: activePriority,
            project: activeProjectId,
            goal: activeGoalId,
            due: (due as TaskDueFilter | null) ?? DEFAULT_TASK_DUE_FILTER,
            sort: activeSort,
            view: activeView,
            layout: activeLayout,
          })
        }
      />

      <FilterPills
        label="Sort"
        options={sortOptions}
        activeValue={activeSort}
        hrefForValue={(sort) =>
          buildTaskListUrl(basePath, {
            status: activeStatus,
            priority: activePriority,
            project: activeProjectId,
            goal: activeGoalId,
            due: activeDueFilter,
            sort: (sort as TaskSortValue | null) ?? DEFAULT_TASK_SORT,
            view: activeView,
            layout: activeLayout,
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
    estimateMin?: number | string | null;
    estimateMax?: number | string | null;
    dueWithin?: number | string | null;
    activeTasks?: boolean | null;
    project?: string | null;
    goal?: string | null;
    due?: TaskDueFilter;
    sort?: TaskSortValue;
    view?: string | null;
    layout?: TaskLayoutMode;
  },
) {
  return buildTaskListUrl(basePath, filters);
}

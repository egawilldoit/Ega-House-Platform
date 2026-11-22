"use client";

import Link from "next/link";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  TASK_DUE_FILTER_VALUES,
  type TaskDueFilter,
} from "@/lib/task-list";
import {
  TASK_STATUS_VALUES,
  formatTaskToken,
  type TaskStatus,
} from "@/lib/task-domain";

const DUE_LABELS: Record<TaskDueFilter, string> = {
  all: "Any due date",
  overdue: "Overdue",
  due_today: "Due today",
  due_soon: "Due soon",
  no_due_date: "No due date",
};

type TaskFilterBarProps = {
  view: "active" | "archived";
  search: string;
  status: TaskStatus | null;
  project: string | null;
  due: TaskDueFilter;
  projects: Array<{ id: string; name: string }>;
  returnTo: string;
};

/**
 * Four controls, one URL contract: Search, Status, Project, Due.
 *
 * The form is a plain GET so it works without client JavaScript. Selecting a
 * value submits immediately; the explicit Apply button keeps the same form
 * usable by keyboard and by clients that do not run scripts.
 */
export function TaskFilterBar({
  view,
  search,
  status,
  project,
  due,
  projects,
  returnTo,
}: TaskFilterBarProps) {
  return (
    <form
      action="/tasks"
      method="get"
      role="search"
      aria-label="Filter tasks"
      data-testid="task-filter-bar"
      className="flex flex-wrap items-end gap-2 border-b border-[var(--ega-divider)] px-[18px] py-3"
    >
      <input type="hidden" name="view" value={view} />

      <label className="flex min-w-48 flex-1 flex-col gap-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
        <span className="sr-only">Search tasks</span>
        <span className="relative">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--ega-text-tertiary)]"
            aria-hidden="true"
          />
          <Input
            name="q"
            defaultValue={search}
            placeholder="Search tasks"
            autoComplete="off"
            className="h-8 pl-7 text-[length:var(--text-meta-lg)]"
            data-testid="task-filter-search"
          />
        </span>
      </label>

      <label className="flex flex-col gap-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
        Status
        <select
          name="status"
          defaultValue={status ?? ""}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
          className="input-instrument h-8 min-w-32 px-2 text-[length:var(--text-meta-lg)]"
          data-testid="task-filter-status"
        >
          <option value="">Any status</option>
          {TASK_STATUS_VALUES.map((value) => (
            <option key={value} value={value}>
              {formatTaskToken(value)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
        Project
        <select
          name="project"
          defaultValue={project ?? ""}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
          className="input-instrument h-8 min-w-36 px-2 text-[length:var(--text-meta-lg)]"
          data-testid="task-filter-project"
        >
          <option value="">Any project</option>
          {projects.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
        Due
        <select
          name="due"
          defaultValue={due}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
          className="input-instrument h-8 min-w-32 px-2 text-[length:var(--text-meta-lg)]"
          data-testid="task-filter-due"
        >
          {TASK_DUE_FILTER_VALUES.map((value) => (
            <option key={value} value={value}>
              {DUE_LABELS[value]}
            </option>
          ))}
        </select>
      </label>

      <Button type="submit" variant="secondary" size="sm" className="h-8 px-3">
        Apply
      </Button>
      <Link
        href={returnTo}
        className="inline-flex h-8 items-center gap-1 px-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)] underline-offset-2 hover:underline"
        aria-label="Clear task filters"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
        Clear
      </Link>
    </form>
  );
}

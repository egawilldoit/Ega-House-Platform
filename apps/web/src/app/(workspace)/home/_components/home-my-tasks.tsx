import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterPill } from "@/components/ui/filter-pill";
import { ListChecks } from "lucide-react";

import type { HomeMyTasks, HomeMyTasksTab, HomeMyTasksTabKey } from "../_lib/home-page-model";
import { HomeTaskPreviewRow } from "./home-task-row";

const EMPTY_COPY: Record<HomeMyTasksTabKey, { title: string; description: string }> = {
  upcoming: {
    title: "Nothing upcoming",
    description: "No open work is waiting on a due date or a future window.",
  },
  overdue: {
    title: "Nothing overdue",
    description: "Every open task is on schedule.",
  },
  completed: {
    title: "No completed tasks yet",
    description: "Completed work will appear here with its project context.",
  },
};

function ActiveTabBody({ tab }: { tab: HomeMyTasksTab }) {
  if (tab.count === null) {
    return (
      <p
        className="rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[var(--ega-surface-subtle)] px-3 py-2 text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]"
        data-testid="home-my-tasks-unavailable"
      >
        Tasks are unavailable right now. Your saved work is unaffected.
      </p>
    );
  }

  if (tab.tasks.length === 0) {
    const copy = EMPTY_COPY[tab.key];
    return (
      <EmptyState
        icon={ListChecks}
        title={copy.title}
        description={copy.description}
        className="py-4"
      />
    );
  }

  return <div className="flex flex-col">{tab.tasks.map((task) => <HomeTaskPreviewRow key={task.id} task={task} />)}</div>;
}

/**
 * My tasks with URL-backed tabs.
 *
 * Tab counts and the "View all" destination share the Tasks URL filter scope,
 * so a tab's total is always the total the destination will show. A failed read
 * renders an unavailable note, never a zero.
 */
export function HomeMyTasksPanel({ myTasks }: { myTasks: HomeMyTasks }) {
  const active =
    myTasks.tabs.find((tab) => tab.key === myTasks.activeTab) ?? myTasks.tabs[0];

  if (!active) {
    return null;
  }

  const hasMore = active.count !== null && active.count > active.tasks.length;

  return (
    <Card
      title="My tasks"
      data-testid="home-my-tasks"
      action={
        <Link
          href={active.viewAllHref}
          className="inline-flex items-center gap-1 text-[length:var(--text-meta-lg)] font-medium text-[color:var(--ega-text-secondary)] hover:text-[color:var(--ega-text)]"
        >
          Open in Tasks
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      }
    >
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="My tasks views">
          {myTasks.tabs.map((tab) => {
            const isActive = tab.key === active.key;
            const label =
              tab.count === null ? tab.label : `${tab.label} ${tab.count}`;

            return (
              <FilterPill
                key={tab.key}
                href={tab.href}
                label={label}
                active={isActive}
                ariaCurrent={isActive ? "page" : undefined}
              />
            );
          })}
        </div>

        <ActiveTabBody tab={active} />

        {hasMore ? (
          <Link
            href={active.viewAllHref}
            className="inline-flex items-center gap-1 text-[length:var(--text-meta-lg)] font-medium text-[color:var(--ega-text-secondary)] underline-offset-4 hover:text-[color:var(--ega-text)] hover:underline"
          >
            View all {active.count} tasks
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}

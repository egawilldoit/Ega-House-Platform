import { CheckCircle2, CircleAlert, Clock3, FolderKanban, ListChecks } from "lucide-react";

import { StatCard } from "@/components/ui/stat-card";
import { formatDisplayDuration } from "@/lib/presentation-format";

import type { HomeStats } from "../_lib/home-page-model";
import { HomeCountValue } from "./home-stat-value";

const UNAVAILABLE = "Unavailable";
const UNAVAILABLE_SUBTITLE = "Unavailable right now";

function StatValue({ count }: { count: number | null }) {
  if (count === null) {
    return <span className="text-[color:var(--ega-text-tertiary)]">&mdash;</span>;
  }

  return <HomeCountValue value={count} />;
}

function countLabel(label: string, count: number | null) {
  return count === null ? `${label}: ${UNAVAILABLE}` : `${label}: ${count}`;
}

/**
 * Clickable Home stat cards.
 *
 * Each card links to the canonical destination that owns the same scope, and a
 * failed aggregate renders "Unavailable" rather than a fabricated zero.
 */
export function HomeStatsSection({ stats }: { stats: HomeStats }) {
  const projectSubtitle =
    stats.activeProjects.count === null
      ? UNAVAILABLE_SUBTITLE
      : stats.activeProjects.atRiskCount === null
        ? "At-risk signal unavailable"
        : `${stats.activeProjects.atRiskCount} at risk`;

  return (
    <section
      className="grid grid-cols-2 gap-3 lg:grid-cols-5"
      data-testid="home-stats"
      aria-label="Workspace stats"
    >
      <StatCard
        label="Active projects"
        href={stats.activeProjects.href}
        linkLabel={`${countLabel("Active projects", stats.activeProjects.count)}. ${projectSubtitle}. Open the active project list.`}
        icon={FolderKanban}
        value={<StatValue count={stats.activeProjects.count} />}
        subtitle={projectSubtitle}
        data-testid="home-stat-projects"
      />
      <StatCard
        label="Open tasks"
        href={stats.openTasks.href}
        linkLabel={`${countLabel("Open tasks", stats.openTasks.count)}. View open tasks.`}
        icon={ListChecks}
        value={<StatValue count={stats.openTasks.count} />}
        subtitle={stats.openTasks.count === null ? UNAVAILABLE_SUBTITLE : "not yet done"}
        data-testid="home-stat-open-tasks"
      />
      <StatCard
        label="Completed this week"
        href={stats.completedThisWeek.href}
        linkLabel={`${countLabel("Completed this week", stats.completedThisWeek.count)}. Open weekly analytics.`}
        icon={CheckCircle2}
        value={<StatValue count={stats.completedThisWeek.count} />}
        subtitle={
          stats.completedThisWeek.count === null ? UNAVAILABLE_SUBTITLE : "counted at completion time"
        }
        data-testid="home-stat-completed"
      />
      <StatCard
        label="Overdue"
        href={stats.overdue.href}
        linkLabel={`${countLabel("Overdue", stats.overdue.count)}. View overdue tasks.`}
        icon={CircleAlert}
        value={<StatValue count={stats.overdue.count} />}
        subtitle={
          stats.overdue.count === null
            ? UNAVAILABLE_SUBTITLE
            : stats.overdue.count > 0
              ? "need attention"
              : "all on track"
        }
        data-testid="home-stat-overdue"
      />
      <StatCard
        label="Tracked this week"
        href={stats.trackedThisWeek.href}
        linkLabel={
          stats.trackedThisWeek.minutes === null
            ? "Tracked time this week unavailable. Open weekly analytics."
            : `Tracked this week: ${formatDisplayDuration(stats.trackedThisWeek.minutes * 60, "minute")}. Open weekly analytics.`
        }
        icon={Clock3}
        value={
          stats.trackedThisWeek.minutes === null ? (
            <span className="text-[color:var(--ega-text-tertiary)]">&mdash;</span>
          ) : (
            formatDisplayDuration(stats.trackedThisWeek.minutes * 60, "minute")
          )
        }
        subtitle={stats.trackedThisWeek.minutes === null ? UNAVAILABLE_SUBTITLE : "this week"}
        data-testid="home-stat-tracked"
      />
    </section>
  );
}

import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";

import {
  DashboardMetricCard,
  DeploymentFocusPanel,
  PriorityQueuePanel,
} from "./_components/dashboard-panels";
import { getDashboardData } from "./_lib/dashboard-data";

export const metadata: Metadata = {
  title: "Dashboard | EGA House",
  description: "Read-only operational snapshot across health, tasks, and timer.",
};

export default async function DashboardPage() {
  const { health, todaysTasks, activeTimer, projectStatuses, linearProject } =
    await getDashboardData();
  const tasks = todaysTasks.data ?? [];
  const completedTaskCount = tasks.filter((task) => task.status === "done").length;
  const completionRate =
    tasks.length > 0 ? Math.round((completedTaskCount / tasks.length) * 100) : null;
  const activeProjectCount =
    projectStatuses.data?.filter((project) => project.status === "active").length ?? 0;
  const totalProjectCount = projectStatuses.data?.length ?? 0;

  return (
    <AppShell
      eyebrow="Dashboard Workspace"
      title="Dashboard"
      description="Plan, prioritize, and accomplish your tasks with ease."
      actions={
        <>
          <Link href="/tasks" className="btn-instrument h-9 px-5 text-[13px]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Project
          </Link>
          <Link href="/review" className="btn-instrument btn-instrument-muted h-9 px-5 text-[13px]">
            Import Data
          </Link>
        </>
      }
    >
      <div className="grid gap-6">
        <div className="grid gap-6 xl:grid-cols-3">
          <DashboardMetricCard
            label="Task Flow"
            value={todaysTasks.error ? "--" : tasks.length.toString()}
            detail={
              todaysTasks.error
                ? todaysTasks.error
                : tasks.length > 0
                  ? `${tasks.filter((task) => task.priority === "urgent").length} urgent in queue`
                  : "No updates recorded today"
            }
            tone={todaysTasks.error ? "error" : tasks.length > 0 ? "active" : "muted"}
          />
          <DashboardMetricCard
            label="Completion Rate"
            value={completionRate === null ? "--" : `${completionRate}%`}
            detail={
              todaysTasks.error
                ? "Task feed unavailable"
                : tasks.length > 0
                  ? `${completedTaskCount} of ${tasks.length} tasks completed`
                  : "Waiting for task activity"
            }
            tone={
              completionRate === null
                ? "muted"
                : completionRate >= 80
                  ? "active"
                  : completionRate >= 50
                    ? "warn"
                    : "error"
            }
          />
          <DashboardMetricCard
            label="Active Projects"
            value={projectStatuses.error ? "--" : `${activeProjectCount}/${totalProjectCount || 0}`}
            detail={
              projectStatuses.error
                ? projectStatuses.error
                : totalProjectCount > 0
                  ? `${totalProjectCount - activeProjectCount} non-active in current slice`
                  : "No project records available"
            }
            tone={projectStatuses.error ? "error" : activeProjectCount > 0 ? "info" : "muted"}
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <DeploymentFocusPanel
            health={health}
            activeSession={activeTimer.data}
            activeTimerError={activeTimer.error}
            project={linearProject.data}
            projectError={linearProject.error}
          />
          <PriorityQueuePanel tasks={todaysTasks.data} error={todaysTasks.error} />
        </div>
      </div>
    </AppShell>
  );
}

import type { Metadata } from "next";

import { getCurrentUser } from "@/lib/services/auth-service";
import { isTaskCompletedStatus } from "@/lib/task-domain";

import { DashboardOptimizedView } from "./_components/DashboardOptimizedView";
import { getDashboardData } from "./_lib/dashboard-data";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Read-only operational snapshot across health, tasks, and timer.",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ stoppedTaskId?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const stoppedTaskId = resolvedSearchParams.stoppedTaskId?.slice(0, 80) ?? null;
  const data = await getDashboardData();
  const user = await getCurrentUser();
  const { todayPlanner, projectStatuses } = data;

  const tasks = todayPlanner.data?.all ?? [];
  const completedCount = tasks.filter((task) => isTaskCompletedStatus(task.status)).length;
  const completionRate =
    tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : null;
  const urgentCount = tasks.filter((t) => t.priority === "urgent").length;

  const activeProjectCount =
    projectStatuses.data?.filter((project) => project.status === "active").length ?? 0;
  const totalProjectCount = projectStatuses.data?.length ?? 0;

  return (
    <DashboardOptimizedView
      data={data}
      ownerUserId={user?.id ?? null}
      completedCount={completedCount}
      completionRate={completionRate}
      urgentCount={urgentCount}
      activeProjectCount={activeProjectCount}
      totalProjectCount={totalProjectCount}
      stoppedTaskId={stoppedTaskId}
    />
  );
}

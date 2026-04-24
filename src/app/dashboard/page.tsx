import type { Metadata } from "next";

import { getCurrentUser } from "@/lib/services/auth-service";

import { DashboardOptimizedView } from "./_components/DashboardOptimizedView";
import { getDashboardData } from "./_lib/dashboard-data";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Read-only operational snapshot across health, tasks, and timer.",
};

export default async function DashboardPage() {
  const data = await getDashboardData();
  const user = await getCurrentUser();
  const { todayPlanner, projectStatuses } = data;

  const tasks = todayPlanner.data?.all ?? [];
  const completedCount = tasks.filter((task) => task.status === "done").length;
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
    />
  );
}

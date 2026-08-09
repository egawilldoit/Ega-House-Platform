import Link from "next/link";

import { ClockIcon } from "lucide-react";

import { StatCard } from "@/components/ui/stat-card";
import { formatDurationLabel } from "@/lib/task-session";

import type { DashboardWorkStats } from "../_lib/dashboard-data";

interface WorkStatsPulseProps {
  workStats: DashboardWorkStats | null;
  workStatsError: string | null;
}

export function WorkStatsPulse({ workStats, workStatsError }: WorkStatsPulseProps) {
  if (workStatsError) {
    return (
      <StatCard label="Worked today" value="--" subtitle="Analytics unavailable" icon={ClockIcon} />
    );
  }
  if (!workStats) {
    return (
      <StatCard label="Worked today" value="--" subtitle="Sign in required" icon={ClockIcon} />
    );
  }
  return (
    <Link href="/work-analytics" className="block">
      <StatCard
        label="Worked today"
        value={formatDurationLabel(workStats.totalWorkedMinutes * 60)}
        subtitle={`${workStats.sessionCount} sessions · ${workStats.currentStreak} day streak`}
        icon={ClockIcon}
      />
    </Link>
  );
}

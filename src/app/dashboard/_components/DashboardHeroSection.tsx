import { AlertCircle, AlertTriangle, ArrowUpRight, Clock as ClockIcon, LayoutGrid, ListTodo } from "lucide-react";

import { StatCard } from "@/components/ui/stat-card";

import { WorkStatsPulse } from "./WorkStatsPulse";
import { getGreeting, getHeroSummary } from "../_lib/dashboard-helpers";
import type { DashboardData } from "../_lib/dashboard-data";

interface DashboardHeroSectionProps {
  displayName: string;
  completionRate: number | null;
  todayCount: number;
  completedCount: number;
  urgentCount: number;
  activeProjectCount: number;
  totalProjectCount: number;
  timerSummary: DashboardData["timerSummary"]["data"];
  workStats: DashboardData["workStats"]["data"];
  workStatsError: string | null;
}

export function DashboardHeroSection({
  displayName,
  completionRate,
  todayCount,
  completedCount,
  urgentCount,
  activeProjectCount,
  totalProjectCount,
  timerSummary,
  workStats,
  workStatsError,
}: DashboardHeroSectionProps) {
  const greeting = getGreeting();
  const ringPercent = completionRate ?? 0;

  return (
    <section className="ega-dashboard-hero ega-dashboard-hero-compact">
      <div className="ega-dashboard-hero-copy relative overflow-hidden">
        <p className="glass-label text-[color:var(--signal-live)]">Live Workspace State</p>
        <div className="flex items-center gap-6 mt-4">
          <div className="relative w-16 h-16 flex-shrink-0">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
              <path
                className="text-[var(--border)]"
                strokeWidth="3"
                stroke="currentColor"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                className="text-[var(--signal-live)]"
                strokeWidth="3"
                strokeDasharray={`${ringPercent}, 100`}
                stroke="currentColor"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center font-display text-sm font-bold text-[color:var(--foreground)]">
              {ringPercent}%
            </div>
          </div>
          <div>
            <h2 className="ega-dashboard-hero-title">
              {greeting}, <span>{displayName}.</span>
            </h2>
            <p className="ega-dashboard-hero-subtitle mt-2">
              {getHeroSummary(todayCount, completionRate)}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Tasks In Focus"
          value={String(todayCount)}
          subtitle={completedCount > 0 ? `${completedCount} completed recently` : "Backlog surfaced when today is quiet"}
          variant="green"
          icon={ListTodo}
          className="border-t-4 border-t-[var(--signal-live)]"
          trend={<ArrowUpRight className="w-3 h-3 text-[var(--signal-live)] inline-block mr-1" />}
        />
        <StatCard
          label="Urgent"
          value={String(urgentCount)}
          subtitle={urgentCount > 0 ? "Immediate attention required" : "No urgent queue"}
          variant={urgentCount > 0 ? "default" : "muted"}
          icon={AlertCircle}
          className={urgentCount > 0 ? "border-t-4 border-t-[var(--signal-warn)]" : ""}
          trend={urgentCount > 0 ? <AlertTriangle className="w-3 h-3 text-[var(--signal-warn)] inline-block mr-1" /> : undefined}
        />
        <StatCard
          label="Tracked Today"
          value={timerSummary?.trackedTodayLabel ?? "--"}
          subtitle={timerSummary ? timerSummary.trackedTotalLabel : "Timer history unavailable"}
          icon={ClockIcon}
          className="border-t-4 border-t-[var(--signal-info)]"
        />
        <StatCard
          label="Projects"
          value={`${activeProjectCount}/${totalProjectCount}`}
          subtitle="Active vs total projects"
          icon={LayoutGrid}
          className="border-t-4 border-t-[var(--foreground)]"
        />
        <WorkStatsPulse workStats={workStats} workStatsError={workStatsError} />
      </div>
    </section>
  );
}

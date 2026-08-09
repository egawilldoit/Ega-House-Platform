import Link from "next/link";

import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatIsoDate } from "@/lib/review-week";
import { formatTaskToken } from "@/lib/task-domain";

import type { DashboardData } from "../_lib/dashboard-data";

interface CommandCenterSpotlightProps {
  project: DashboardData["linearProject"];
  activeTimer: DashboardData["activeTimer"];
  health: DashboardData["health"];
  timerSummary: DashboardData["timerSummary"]["data"];
}

export function CommandCenterSpotlight({
  project,
  activeTimer,
  health,
  timerSummary,
}: CommandCenterSpotlightProps) {
  const projectHeadline =
    project.data?.name ?? activeTimer.data?.projectName ?? "Workspace command";
  const projectNarrative = project.data?.status
    ? `${formatTaskToken(project.data.status)} · ${
        project.data.targetDate
          ? `Target ${formatIsoDate(project.data.targetDate)}`
          : "No target date"
      }`
    : activeTimer.data
      ? `Timer active on ${activeTimer.data.taskTitle}`
      : "No Linear token is configured, so this panel falls back to your local workspace state.";

  return (
    <Card className="ega-dashboard-spotlight border-transparent">
      <CardContent className="p-0">
        <div className="ega-dashboard-spotlight-shell">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="active">Command center</Badge>
            {project.data?.status ? (
              <StatusBadge
                status={project.data.status}
                label={formatTaskToken(project.data.status)}
              />
            ) : null}
            {activeTimer.error ? <Badge tone="warn">Timer feed issue</Badge> : null}
          </div>
          {health.state !== "healthy" ? (
            <div className="mt-4 flex w-fit items-center gap-2 rounded-full border border-[rgba(230,81,0,0.28)] bg-[rgba(230,81,0,0.08)] px-3 py-1.5 text-xs font-semibold tracking-wide text-[color:var(--signal-warn)] shadow-sm">
              <AlertTriangle className="w-3.5 h-3.5" />
              {health.statusText}
            </div>
          ) : null}

          <div className="mt-5 max-w-3xl">
            <p className="glass-label text-white/70">Current focus</p>
            <h3 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white md:text-4xl">
              {projectHeadline}
            </h3>
            <p className="mt-4 text-sm leading-7 text-white/74">{projectNarrative}</p>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-3">
            <div className="ega-dashboard-spotlight-stat">
              <span className="glass-label text-white/60">Timer</span>
              <strong>{activeTimer.data?.elapsedLabel ?? "Idle"}</strong>
              <span>{activeTimer.data ? activeTimer.data.taskTitle : "No open session"}</span>
            </div>
            <div className="ega-dashboard-spotlight-stat">
              <span className="glass-label text-white/60">Health</span>
              <strong>{health.state === "healthy" ? "Nominal" : "Degraded"}</strong>
              <span>{health.statusText}</span>
            </div>
            <div className="ega-dashboard-spotlight-stat">
              <span className="glass-label text-white/60">Longest</span>
              <strong>{timerSummary?.longestSessionLabel ?? "--"}</strong>
              <span>{timerSummary?.longestSessionTaskTitle ?? "No completed sessions yet"}</span>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/timer" className="btn-instrument">
              Open timer
            </Link>
            <Link href="/tasks" className="btn-instrument btn-instrument-muted">
              Review tasks
            </Link>
            <Link href="/review" className="btn-instrument btn-instrument-muted">
              Weekly review
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

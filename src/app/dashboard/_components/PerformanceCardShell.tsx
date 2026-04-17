import Link from "next/link";

import type {
  DashboardActiveSession,
  DashboardLinearProject,
} from "../_lib/dashboard-data";
import { formatTaskToken } from "@/lib/task-domain";
import { formatTimerDateTime } from "@/lib/timer-domain";

type PerformanceCardShellProps = {
  completionRate: number | null;
  completedCount: number;
  totalCount: number;
  activeSession: DashboardActiveSession | null;
  project: DashboardLinearProject | null;
};

export function PerformanceCardShell({
  completionRate,
  completedCount,
  totalCount,
  activeSession,
  project,
}: PerformanceCardShellProps) {
  const percent = completionRate ?? 0;
  const statusText = activeSession
    ? activeSession.elapsedLabel
    : project?.status
      ? formatTaskToken(project.status)
      : "Idle";

  const sessionLabel = activeSession
    ? `Tracking: ${activeSession.taskTitle}`
    : project?.name
      ? project.name
      : "No active session";

  return (
    <div
      className="dashboard-performance-shell"
      style={{ padding: "1.5rem", height: "100%", display: "flex", flexDirection: "column" }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" }}>
        <div>
          <p
            style={{
              fontSize: "0.625rem",
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.65)",
              marginBottom: "0.375rem",
            }}
          >
            Task Performance
          </p>
          <p
            style={{
              fontSize: "2.75rem",
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: "-0.04em",
              color: "#ffffff",
            }}
          >
            {completionRate === null ? "--" : `${percent}%`}
          </p>
          <p
            style={{
              fontSize: "0.75rem",
              color: "rgba(255,255,255,0.7)",
              marginTop: "0.25rem",
            }}
          >
            {totalCount > 0
              ? `${completedCount} of ${totalCount} done today`
              : "Waiting for task activity"}
          </p>
        </div>

        {/* Status chip */}
        <div
          style={{
            background: "rgba(255,255,255,0.18)",
            border: "1px solid rgba(255,255,255,0.25)",
            borderRadius: "999px",
            padding: "0.25rem 0.75rem",
            fontSize: "0.6875rem",
            fontWeight: 600,
            color: "#ffffff",
            whiteSpace: "nowrap",
          }}
        >
          {statusText}
        </div>
      </div>

      {/* Progress bar */}
      <div className="dashboard-performance-progress">
        <div
          className="dashboard-performance-bar"
          style={{ width: `${percent}%` }}
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>

      {/* Callout box */}
      <div className="dashboard-performance-callout" style={{ marginTop: "auto" }}>
        <p
          style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            color: "#ffffff",
            marginBottom: "0.25rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {sessionLabel}
        </p>
        {activeSession ? (
          <p style={{ fontSize: "0.6875rem", color: "rgba(255,255,255,0.65)" }}>
            Started {formatTimerDateTime(activeSession.startedAt)} ·{" "}
            {activeSession.projectName}
          </p>
        ) : (
          <p style={{ fontSize: "0.6875rem", color: "rgba(255,255,255,0.65)" }}>
            {project?.targetDate
              ? `Target ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(project.targetDate))}`
              : "Start a timer to track your session"}
          </p>
        )}
      </div>

      {/* CTA */}
      <div style={{ marginTop: "1rem" }}>
        <Link
          href="/timer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.375rem",
            fontSize: "0.75rem",
            fontWeight: 600,
            color: "rgba(255,255,255,0.8)",
            transition: "color 180ms ease",
          }}
        >
          Open Timer →
        </Link>
      </div>
    </div>
  );
}

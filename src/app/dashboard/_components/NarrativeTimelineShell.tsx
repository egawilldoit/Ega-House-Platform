import Link from "next/link";

import { formatTaskToken, getTaskStatusTone } from "@/lib/task-domain";
import type {
  DashboardLinearProject,
  DashboardProjectStatus,
} from "../_lib/dashboard-data";

type NarrativeTimelineShellProps = {
  project: DashboardLinearProject | null;
  projectError: string | null;
  projectStatuses: DashboardProjectStatus[] | null;
};

function StatusDot({ status }: { status: string }) {
  const tone = getTaskStatusTone(status);
  const colorMap: Record<string, string> = {
    active: "#10b981",
    success: "#10b981",
    warn: "#f59e0b",
    error: "#ef4444",
    info: "#3b82f6",
    muted: "#94a3b8",
    accent: "#8b5cf6",
  };

  return (
    <span
      style={{
        display: "inline-block",
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: colorMap[tone] ?? "#94a3b8",
        flexShrink: 0,
        marginTop: "0.1875rem",
      }}
    />
  );
}

export function NarrativeTimelineShell({
  project,
  projectError,
  projectStatuses,
}: NarrativeTimelineShellProps) {
  const milestones = project?.milestones ?? [];
  const issueStatuses = project?.issueStatusCounts ?? [];
  const activeProjects = (projectStatuses ?? []).filter(
    (p) => p.status === "active",
  );

  return (
    <div
      className="dashboard-panel"
      style={{ padding: "1.5rem", height: "100%", display: "flex", flexDirection: "column" }}
    >
      {/* Header */}
      <div style={{ marginBottom: "1.25rem" }}>
        <p className="text-overline" style={{ marginBottom: "0.25rem" }}>
          Deployment Narrative
        </p>
        <h2 className="dashboard-panel-heading">
          {project?.name ?? "Project Overview"}
        </h2>
      </div>

      {/* Error */}
      {projectError ? (
        <p
          style={{
            fontSize: "0.8125rem",
            color: "#ef4444",
            padding: "0.75rem",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "0.75rem",
          }}
        >
          {projectError}
        </p>
      ) : null}

      {/* No project */}
      {!projectError && !project ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--muted-foreground)",
            fontSize: "0.8125rem",
            border: "1px dashed #e4e7ec",
            borderRadius: "0.875rem",
            padding: "2rem",
            textAlign: "center",
          }}
        >
          No Linear project snapshot available.
        </div>
      ) : null}

      {/* Project content */}
      {!projectError && project ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", flex: 1 }}>
          {/* Status + target */}
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              flexWrap: "wrap",
            }}
          >
            {project.status ? (
              <span
                style={{
                  padding: "0.25rem 0.625rem",
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  borderRadius: "999px",
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  color: "#059669",
                }}
              >
                {formatTaskToken(project.status)}
              </span>
            ) : null}
            {project.targetDate ? (
              <span
                style={{
                  padding: "0.25rem 0.625rem",
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  borderRadius: "999px",
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  color: "#d97706",
                }}
              >
                Target{" "}
                {new Intl.DateTimeFormat("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                }).format(new Date(project.targetDate))}
              </span>
            ) : null}
          </div>

          {/* Issue status counts */}
          {issueStatuses.length > 0 ? (
            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #e4e7ec",
                borderRadius: "0.875rem",
                padding: "0.75rem",
              }}
            >
              <p className="text-overline" style={{ marginBottom: "0.5rem" }}>
                Issues
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                {issueStatuses.slice(0, 4).map((entry) => (
                  <div
                    key={entry.state}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "0.5rem",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <StatusDot status={entry.state} />
                      <span style={{ fontSize: "0.75rem", color: "var(--foreground)" }}>
                        {formatTaskToken(entry.state)}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        color: "var(--muted-foreground)",
                      }}
                    >
                      {entry.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Milestones */}
          {milestones.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
              <p className="text-overline">Milestones</p>
              {milestones.slice(0, 3).map((m) => (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                    padding: "0.5rem 0.75rem",
                    background: "#f8fafc",
                    border: "1px solid #e4e7ec",
                    borderRadius: "0.75rem",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--foreground)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {m.name}
                  </span>
                  <span
                    style={{
                      fontSize: "0.6875rem",
                      fontWeight: 600,
                      color: m.progressPercent !== null ? "#10b981" : "var(--muted-foreground)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {m.progressPercent !== null ? `${m.progressPercent}%` : "–"}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {/* Project link */}
          {project.url ? (
            <Link
              href={project.url}
              target="_blank"
              rel="noreferrer"
              style={{
                marginTop: "auto",
                fontSize: "0.6875rem",
                fontWeight: 600,
                color: "#10b981",
              }}
            >
              Open Linear →
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* Active projects fallback */}
      {!projectError && !project && activeProjects.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          {activeProjects.slice(0, 4).map((p) => (
            <div
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.5rem 0.75rem",
                background: "#f8fafc",
                border: "1px solid #e4e7ec",
                borderRadius: "0.75rem",
              }}
            >
              <StatusDot status={p.status} />
              <span style={{ fontSize: "0.75rem", color: "var(--foreground)" }}>
                {p.name}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

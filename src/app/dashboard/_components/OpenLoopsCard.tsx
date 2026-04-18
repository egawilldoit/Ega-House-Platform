import Link from "next/link";

import { TaskDueDateLabel } from "@/components/tasks/task-due-date-label";
import { Badge } from "@/components/ui/badge";
import { formatTaskToken, getTaskStatusTone } from "@/lib/task-domain";
import type { DashboardTodayTask } from "../_lib/dashboard-data";

type OpenLoopsCardProps = {
  tasks: DashboardTodayTask[] | null;
  error: string | null;
};

function getPriorityColor(task: DashboardTodayTask) {
  if (task.status === "blocked" || task.priority === "urgent") return "#ef4444";
  if (task.priority === "high") return "#f59e0b";
  if (task.status === "in_progress") return "#10b981";
  return "#94a3b8";
}

function getPriorityLabel(task: DashboardTodayTask) {
  if (task.status === "blocked") return "Blocked";
  if (task.priority === "urgent") return "Critical";
  if (task.priority === "high") return "High";
  return formatTaskToken(task.status);
}

export function OpenLoopsCard({ tasks, error }: OpenLoopsCardProps) {
  const visibleTasks = tasks?.slice(0, 5) ?? [];

  return (
    <div
      className="dashboard-panel"
      style={{ padding: "1.5rem", height: "100%", display: "flex", flexDirection: "column" }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "1.25rem",
        }}
      >
        <div>
          <p className="text-overline" style={{ marginBottom: "0.25rem" }}>
            Open Loops
          </p>
          <h2 className="dashboard-panel-heading">Priority Queue</h2>
        </div>
        <Link
          href="/tasks"
          style={{
            fontSize: "0.6875rem",
            fontWeight: 600,
            color: "#10b981",
            letterSpacing: "0.02em",
          }}
        >
          View all →
        </Link>
      </div>

      {/* Error state */}
      {error ? (
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
          {error}
        </p>
      ) : null}

      {/* Empty state */}
      {!error && visibleTasks.length === 0 ? (
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
          No task pressure detected today.
        </div>
      ) : null}

      {/* Task list */}
      {!error && visibleTasks.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          {visibleTasks.map((task) => {
            const dotColor = getPriorityColor(task);
            const label = getPriorityLabel(task);
            const tone = getTaskStatusTone(task.status);

            return (
              <article
                key={task.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.75rem",
                  padding: "0.625rem 0.75rem",
                  borderRadius: "0.875rem",
                  border: "1px solid transparent",
                  transition: "background 180ms ease, border-color 180ms ease",
                  cursor: "default",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "#f8fafc";
                  (e.currentTarget as HTMLElement).style.borderColor = "#e4e7ec";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                  (e.currentTarget as HTMLElement).style.borderColor = "transparent";
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: "0.625rem", minWidth: 0 }}>
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: dotColor,
                      flexShrink: 0,
                      marginTop: "0.375rem",
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <p
                      style={{
                        fontSize: "0.8125rem",
                        fontWeight: 500,
                        color: "var(--foreground)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {task.title}
                    </p>
                    <p
                      style={{
                        fontSize: "0.625rem",
                        color: "var(--muted-foreground)",
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        marginTop: "0.125rem",
                      }}
                    >
                      {task.projectName}
                      {task.goalTitle ? ` · ${task.goalTitle}` : ""}
                    </p>
                    <div style={{ marginTop: "0.375rem" }}>
                      <TaskDueDateLabel dueDate={task.dueDate} status={task.status} />
                    </div>
                  </div>
                </div>
                <Badge tone={tone}>{label}</Badge>
              </article>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

import type { DashboardActiveSession, DashboardHealthData } from "../_lib/dashboard-data";

type ExecutionOverviewCardProps = {
  health: DashboardHealthData;
  activeSession: DashboardActiveSession | null;
  activeTimerError: string | null;
  taskCount: number;
  completedCount: number;
  urgentCount: number;
};

function MetricPill({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        padding: "0.875rem 1rem",
        background: accent ? "#f0fdf4" : "#f8fafc",
        border: `1px solid ${accent ? "#bbf7d0" : "#e4e7ec"}`,
        borderRadius: "0.875rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem",
      }}
    >
      <p
        style={{
          fontSize: "0.625rem",
          fontWeight: 600,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: accent ? "#059669" : "var(--muted-foreground)",
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: "1.625rem",
          fontWeight: 700,
          letterSpacing: "-0.03em",
          color: accent ? "#059669" : "var(--foreground)",
          lineHeight: 1,
        }}
      >
        {value}
      </p>
    </div>
  );
}

export function ExecutionOverviewCard({
  health,
  activeSession,
  activeTimerError,
  taskCount,
  completedCount,
  urgentCount,
}: ExecutionOverviewCardProps) {
  const timerValue = activeTimerError
    ? "–"
    : activeSession
      ? activeSession.elapsedLabel
      : "Idle";

  const healthColor =
    health.state === "healthy" ? "#10b981" : "#f59e0b";

  return (
    <div
      className="dashboard-panel"
      style={{ padding: "1.5rem", height: "100%", display: "flex", flexDirection: "column" }}
    >
      {/* Card heading */}
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
            Execution overview
          </p>
          <h2 className="dashboard-panel-heading">Today&apos;s Activity</h2>
        </div>

        {/* Health indicator */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.375rem 0.75rem",
            background: health.state === "healthy" ? "#f0fdf4" : "#fffbeb",
            border: `1px solid ${health.state === "healthy" ? "#bbf7d0" : "#fde68a"}`,
            borderRadius: "999px",
            fontSize: "0.6875rem",
            fontWeight: 600,
            color: healthColor,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: healthColor,
              flexShrink: 0,
            }}
          />
          {health.state === "healthy" ? "Nominal" : "Degraded"}
        </div>
      </div>

      {/* Placeholder chart area */}
      <div
        style={{
          flex: 1,
          background: "linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)",
          border: "1px solid #e4e7ec",
          borderRadius: "0.875rem",
          display: "flex",
          alignItems: "flex-end",
          padding: "1rem",
          gap: "0.375rem",
          minHeight: "80px",
          overflow: "hidden",
        }}
        aria-hidden="true"
      >
        {/* Decorative bar chart */}
        {[40, 65, 50, 80, 55, 90, taskCount > 0 ? Math.min(100, (completedCount / taskCount) * 100) : 30].map(
          (h, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: `${h}%`,
                background: i === 6 ? "#10b981" : "#e4e7ec",
                borderRadius: "4px 4px 0 0",
                transition: "height 0.4s ease",
              }}
            />
          ),
        )}
      </div>

      {/* Metric strip */}
      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          marginTop: "0.875rem",
        }}
      >
        <MetricPill label="Tasks Today" value={String(taskCount)} />
        <MetricPill label="Done" value={String(completedCount)} accent />
        <MetricPill label="Urgent" value={String(urgentCount)} />
        <MetricPill label="Timer" value={timerValue} />
      </div>
    </div>
  );
}

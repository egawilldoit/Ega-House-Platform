type DashboardHeroProps = {
  userName?: string;
  taskCount: number;
  completionRate: number | null;
};

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatTodayLabel() {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
}

export function DashboardHero({
  userName,
  taskCount,
  completionRate,
}: DashboardHeroProps) {
  const greeting = getGreeting();
  const displayName = userName ?? "there";
  const dateLabel = formatTodayLabel();

  return (
    <div style={{ padding: "2rem 2rem 0" }}>
      <p className="text-overline" style={{ marginBottom: "0.5rem" }}>
        {dateLabel}
      </p>
      <h1 className="dashboard-hero-title">
        {greeting},{" "}
        <span style={{ color: "#10b981" }}>{displayName}.</span>
      </h1>
      <p
        style={{
          marginTop: "0.5rem",
          fontSize: "0.875rem",
          color: "var(--muted-foreground)",
        }}
      >
        {taskCount > 0
          ? `${taskCount} task${taskCount !== 1 ? "s" : ""} updated today${
              completionRate !== null ? ` · ${completionRate}% complete` : ""
            }`
          : "No task activity recorded yet today."}
      </p>
    </div>
  );
}

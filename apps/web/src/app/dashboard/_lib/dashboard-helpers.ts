export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function getHeroSummary(taskCount: number, completionRate: number | null): string {
  if (taskCount > 0) {
    return `${taskCount} task${taskCount === 1 ? "" : "s"} in today's lane${
      completionRate !== null ? ` · ${completionRate}% done` : ""
    }`;
  }

  return "No work is in today's lane yet. Pin a task, start a timer, or set a due date to shape the day.";
}

export function toPreviewText(value: string | null | undefined, max = 180): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return "No summary recorded yet.";
  }

  if (normalized.length <= max) {
    return normalized;
  }

  return `${normalized.slice(0, max).trimEnd()}…`;
}

export function getTaskContextHref(taskId: string, projectSlug: string | null | undefined): string {
  if (!projectSlug) {
    return "/tasks";
  }

  return `/tasks/projects/${projectSlug}#task-${taskId}`;
}

export function getTodayWindow(): { startIso: string; endIso: string } {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

export function displayNameForUser(user: { user_metadata?: Record<string, unknown> | null; email?: string | null } | null | undefined): string {
  if (!user) return "operator";
  const meta = user.user_metadata ?? {};
  const candidate =
    (typeof meta.display_name === "string" && meta.display_name.trim()) ||
    (typeof meta.full_name === "string" && meta.full_name.trim()) ||
    (typeof meta.name === "string" && meta.name.trim()) ||
    "";
  if (candidate) return candidate;
  const emailLocal = user.email?.split("@")[0]?.trim();
  return emailLocal && emailLocal.length > 0 ? emailLocal : "operator";
}

import { getSessionDurationWithinWindowSeconds } from "@/lib/task-session";

type SessionWindow = {
  startIso: string;
  endIso: string;
};

type MostTrackedSessionRow = {
  task_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  tasks:
    | {
        id: string;
        title: string;
        projects:
          | {
              id: string;
              name: string;
              slug: string;
            }
          | null;
        goals:
          | {
              id: string;
              title: string;
            }
          | null;
      }
    | null;
};

export type MostTrackedInsightRow = {
  id: string;
  label: string;
  href: string | null;
  trackedSeconds: number;
  trackedLabel: string;
  sessionCount: number;
  detail: string;
};

export type MostTrackedInsights = {
  tasks: MostTrackedInsightRow[];
  projects: MostTrackedInsightRow[];
  goals: MostTrackedInsightRow[];
};

function formatCompactDurationLabel(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);

  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h`;
  }

  if (minutes > 0) {
    return `${minutes}m`;
  }

  return `${safeSeconds}s`;
}

function toTaskHref(taskId: string, projectSlug: string | null | undefined) {
  if (!projectSlug) {
    return null;
  }

  return `/tasks/projects/${projectSlug}#task-${taskId}`;
}

function toProjectHref(projectSlug: string | null | undefined) {
  if (!projectSlug) {
    return null;
  }

  return `/tasks/projects/${projectSlug}`;
}

function toGoalHref(goalId: string | null | undefined) {
  if (!goalId) {
    return null;
  }

  return `/goals?view=all&goal=${goalId}#goal-${goalId}`;
}

export function buildMostTrackedInsights(
  sessions: MostTrackedSessionRow[],
  window: SessionWindow,
  nowIso = new Date().toISOString(),
  limit = 5,
): MostTrackedInsights {
  const taskBuckets = new Map<string, Omit<MostTrackedInsightRow, "trackedLabel">>();
  const projectBuckets = new Map<string, Omit<MostTrackedInsightRow, "trackedLabel">>();
  const goalBuckets = new Map<string, Omit<MostTrackedInsightRow, "trackedLabel">>();

  for (const session of sessions) {
    const trackedSeconds = getSessionDurationWithinWindowSeconds(session, window, nowIso);

    if (trackedSeconds <= 0 || !session.tasks?.id) {
      continue;
    }

    const task = session.tasks;
    const project = task.projects;
    const goal = task.goals;

    const existingTask = taskBuckets.get(task.id);
    taskBuckets.set(task.id, {
      id: task.id,
      label: task.title,
      href: toTaskHref(task.id, project?.slug),
      trackedSeconds: (existingTask?.trackedSeconds ?? 0) + trackedSeconds,
      sessionCount: (existingTask?.sessionCount ?? 0) + 1,
      detail: [project?.name, goal?.title].filter(Boolean).join(" • ") || "Tracked task",
    });

    if (project?.id) {
      const existingProject = projectBuckets.get(project.id);
      projectBuckets.set(project.id, {
        id: project.id,
        label: project.name,
        href: toProjectHref(project.slug),
        trackedSeconds: (existingProject?.trackedSeconds ?? 0) + trackedSeconds,
        sessionCount: (existingProject?.sessionCount ?? 0) + 1,
        detail: `${task.title}${goal?.title ? ` • ${goal.title}` : ""}`,
      });
    }

    if (goal?.id) {
      const existingGoal = goalBuckets.get(goal.id);
      goalBuckets.set(goal.id, {
        id: goal.id,
        label: goal.title,
        href: toGoalHref(goal.id),
        trackedSeconds: (existingGoal?.trackedSeconds ?? 0) + trackedSeconds,
        sessionCount: (existingGoal?.sessionCount ?? 0) + 1,
        detail: project?.name ?? task.title,
      });
    }
  }

  const sortAndFormat = (rows: Iterable<Omit<MostTrackedInsightRow, "trackedLabel">>) => {
    return Array.from(rows)
      .sort(
        (left, right) =>
          right.trackedSeconds - left.trackedSeconds ||
          right.sessionCount - left.sessionCount ||
          left.label.localeCompare(right.label),
      )
      .slice(0, limit)
      .map((row) => ({
        ...row,
        trackedLabel: formatCompactDurationLabel(row.trackedSeconds),
      }));
  };

  return {
    tasks: sortAndFormat(taskBuckets.values()),
    projects: sortAndFormat(projectBuckets.values()),
    goals: sortAndFormat(goalBuckets.values()),
  };
}

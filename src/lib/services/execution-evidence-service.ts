import {
  getSessionDurationWithinWindowSeconds,
  getTaskSessionDurationSeconds,
} from "@/lib/task-session";

export type ExecutionEvidenceWindow = {
  startIso: string;
  endIso: string;
};

export type ExecutionEvidenceSessionTask = {
  id?: string | null;
  title?: string | null;
  project_id?: string | null;
  goal_id?: string | null;
  projects?: { id?: string | null; name?: string | null } | null;
  goals?: { id?: string | null; title?: string | null } | null;
} | null;

export type ExecutionEvidenceSessionRow = {
  task_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  tasks?: ExecutionEvidenceSessionTask;
};

export type ExecutionEvidenceTimeBucket = {
  id: string;
  label: string;
  trackedSeconds: number;
  sessionCount: number;
};

export type ExecutionEvidenceSummary = {
  trackedSecondsByTask: Map<string, number>;
  totalTrackedSeconds: number;
  taskTimeBuckets: ExecutionEvidenceTimeBucket[];
  projectTimeBuckets: ExecutionEvidenceTimeBucket[];
  touchedProjectNames: string[];
  touchedGoalTitles: string[];
  sessionCount: number;
};

function getTaskId(session: ExecutionEvidenceSessionRow) {
  return session.tasks?.id ?? session.task_id;
}

function addTimeBucket(
  buckets: Map<string, ExecutionEvidenceTimeBucket>,
  id: string | null | undefined,
  label: string | null | undefined,
  trackedSeconds: number,
) {
  if (!id || !label || trackedSeconds <= 0) {
    return;
  }

  const existing = buckets.get(id);
  buckets.set(id, {
    id,
    label,
    trackedSeconds: (existing?.trackedSeconds ?? 0) + trackedSeconds,
    sessionCount: (existing?.sessionCount ?? 0) + 1,
  });
}

export function getExecutionEvidenceSessionOverlapSeconds(
  session: ExecutionEvidenceSessionRow,
  window: ExecutionEvidenceWindow,
  options?: {
    nowIso?: string;
    includeOpenSessions?: boolean;
  },
) {
  if (options?.includeOpenSessions === false && !session.ended_at) {
    return 0;
  }

  return getSessionDurationWithinWindowSeconds(
    session,
    window,
    options?.nowIso ?? new Date().toISOString(),
  );
}

export function calculateExecutionEvidenceForWindow(
  sessions: ExecutionEvidenceSessionRow[],
  window: ExecutionEvidenceWindow,
  options?: {
    nowIso?: string;
    includeOpenSessions?: boolean;
  },
): ExecutionEvidenceSummary {
  const nowIso = options?.nowIso ?? new Date().toISOString();
  const trackedSecondsByTask = new Map<string, number>();
  const taskTimeBuckets = new Map<string, ExecutionEvidenceTimeBucket>();
  const projectTimeBuckets = new Map<string, ExecutionEvidenceTimeBucket>();
  const touchedProjectNames = new Set<string>();
  const touchedGoalTitles = new Set<string>();
  let totalTrackedSeconds = 0;
  let sessionCount = 0;

  for (const session of sessions) {
    const trackedSeconds = getExecutionEvidenceSessionOverlapSeconds(session, window, {
      nowIso,
      includeOpenSessions: options?.includeOpenSessions,
    });

    if (trackedSeconds <= 0) {
      continue;
    }

    const task = session.tasks;
    const taskId = getTaskId(session);

    totalTrackedSeconds += trackedSeconds;
    sessionCount += 1;
    trackedSecondsByTask.set(
      session.task_id,
      (trackedSecondsByTask.get(session.task_id) ?? 0) + trackedSeconds,
    );
    addTimeBucket(taskTimeBuckets, taskId, task?.title ?? "Untitled task", trackedSeconds);

    if (task?.projects?.name) {
      touchedProjectNames.add(task.projects.name);
      addTimeBucket(
        projectTimeBuckets,
        task.projects.id ?? task.project_id,
        task.projects.name,
        trackedSeconds,
      );
    }

    if (task?.goals?.title) {
      touchedGoalTitles.add(task.goals.title);
    }
  }

  return {
    trackedSecondsByTask,
    totalTrackedSeconds,
    taskTimeBuckets: Array.from(taskTimeBuckets.values()),
    projectTimeBuckets: Array.from(projectTimeBuckets.values()),
    touchedProjectNames: Array.from(touchedProjectNames),
    touchedGoalTitles: Array.from(touchedGoalTitles),
    sessionCount,
  };
}

export function calculateTotalTrackedSeconds(
  sessions: ExecutionEvidenceSessionRow[],
  nowIso = new Date().toISOString(),
) {
  return sessions.reduce(
    (total, session) => total + getTaskSessionDurationSeconds(session, nowIso),
    0,
  );
}

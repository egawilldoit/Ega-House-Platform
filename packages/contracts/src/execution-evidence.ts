export type ExecutionEvidenceWindowDto = Readonly<{
  startIso: string;
  endIso: string;
}>;

export type ExecutionEvidenceSessionRowDto = Readonly<{
  id?: string;
  task_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  tasks?: {
    id?: string | null;
    title?: string | null;
    project_id?: string | null;
    goal_id?: string | null;
    estimate_minutes?: number | null;
    projects?: { id?: string | null; name?: string | null } | null;
    goals?: { id?: string | null; title?: string | null } | null;
  } | null;
}>;

export type EvidenceQualityDto = "sufficient" | "insufficient" | "provisional" | "suspect";

export type ExecutionEvidenceQualityDto = Readonly<{
  quality: EvidenceQualityDto;
  reasons: string[];
  hasOpenSessions: boolean;
  openSessionCount: number;
  malformedCount: number;
  sessionCount: number;
  totalTrackedSeconds: number;
}>;

export type ExecutionEvidenceTimeBucketDto = Readonly<{
  id: string;
  label: string;
  trackedSeconds: number;
  sessionCount: number;
}>;

export type ExecutionEvidenceSummaryDto = Readonly<{
  window: ExecutionEvidenceWindowDto;
  totalTrackedSeconds: number;
  trackedSecondsByTask: Record<string, number>;
  trackedSecondsByProject: Record<string, number>;
  trackedSecondsByGoal: Record<string, number>;
  trackedSecondsByDay: Record<string, number>;
  taskTimeBuckets: ExecutionEvidenceTimeBucketDto[];
  projectTimeBuckets: ExecutionEvidenceTimeBucketDto[];
  goalTimeBuckets: ExecutionEvidenceTimeBucketDto[];
  dayTimeBuckets: ExecutionEvidenceTimeBucketDto[];
  touchedProjectNames: string[];
  touchedGoalTitles: string[];
  sessionCount: number;
  openSessionCount: number;
  malformedCount: number;
  quality: ExecutionEvidenceQualityDto;
  transitions: Array<{
    index: number;
    taskId: string;
    startedAt: string;
    endedAt: string | null;
    projectId: string | null;
    goalId: string | null;
    trackedSeconds: number;
    sessionId: string | null;
  }>;
}>;

export type GetExecutionEvidenceRequest = Readonly<{
  startIso: string;
  endIso: string;
  includeOpenSessions?: boolean;
}>;

export type GetExecutionEvidenceResponse = Readonly<{
  ok: true;
  evidence: ExecutionEvidenceSummaryDto;
}>;

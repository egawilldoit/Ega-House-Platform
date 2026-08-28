import type { TimeContextFallback } from "./time-context";
import type {
  ExecutionEvidenceSummaryDto,
} from "./execution-evidence";

export type WeeklyReviewSavedReviewDto = Readonly<{
  id: string;
  weekStart: string;
  weekEnd: string;
  summary: string | null;
  wins: string | null;
  blockers: string | null;
  nextSteps: string | null;
  createdAt: string;
  updatedAt: string | null;
  officialEmailStatus: string | null;
  officialEmailSentAt: string | null;
}>;

export type WeeklyReviewWeekWindowDto = Readonly<{
  weekOf: string;
  weekStart: string;
  weekEnd: string;
  weekStartUtc: string;
  weekEndExclusiveUtc: string;
  timezone: string;
  requestedTimezone: string | null;
  fallback: TimeContextFallback;
}>;

export type WeeklyReviewBlockedTaskDto = Readonly<{
  id: string;
  title: string;
  blockedReason: string | null;
  updatedAt: string;
}>;

export type WeeklyReviewStatsDto = Readonly<{
  tasksCreated: number;
  sessionsLogged: number;
  trackedSeconds: number;
  goalsTouched: number;
  goalStatusCounts: Array<{ status: string; count: number }>;
  blockedTasks: WeeklyReviewBlockedTaskDto[];
}>;

export type WeeklyReviewMostTrackedInsightDto = Readonly<{
  id: string;
  label: string;
  href: string | null;
  trackedSeconds: number;
  trackedLabel: string;
  sessionCount: number;
  detail: string;
}>;

export type WeeklyReviewMostTrackedDto = Readonly<{
  tasks: WeeklyReviewMostTrackedInsightDto[];
  projects: WeeklyReviewMostTrackedInsightDto[];
  goals: WeeklyReviewMostTrackedInsightDto[];
}>;

export type WeeklyReviewDraftDto = Readonly<{
  summary: string;
  wins: string;
  blockers: string;
  nextSteps: string;
}>;

export type WeeklyReviewMetricComparisonDto = Readonly<{
  current: number;
  previous: number | null;
  delta: number | null;
  percentChange: number | null;
}>;

export type WeeklyReviewComparisonDto = Readonly<{
  currentWindow: WeeklyReviewWeekWindowDto;
  previousWindow: WeeklyReviewWeekWindowDto;
  metrics: Readonly<{
    trackedSeconds: WeeklyReviewMetricComparisonDto;
    sessionCount: WeeklyReviewMetricComparisonDto;
    tasksCreated: WeeklyReviewMetricComparisonDto;
    goalsTouched: WeeklyReviewMetricComparisonDto;
    completedTasks: WeeklyReviewMetricComparisonDto;
  }>;
}>;

export type WeeklyReviewReadModelDto = Readonly<{
  window: WeeklyReviewWeekWindowDto;
  savedReview: WeeklyReviewSavedReviewDto | null;
  pastReviews: WeeklyReviewSavedReviewDto[];
  stats: WeeklyReviewStatsDto;
  evidence: ExecutionEvidenceSummaryDto;
  mostTracked: WeeklyReviewMostTrackedDto;
  generatedDraft: WeeklyReviewDraftDto;
  comparison: WeeklyReviewComparisonDto;
}>;

export type GetWeeklyReviewRequest = Readonly<{
  weekOf?: string;
}>;

export type GetWeeklyReviewResponse = Readonly<{
  ok: true;
  review: WeeklyReviewReadModelDto;
}>;

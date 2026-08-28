import type { MobileTodaySummary, MobileTodayTaskItem } from "./mobile";

export type OperatorSignalsDto = Readonly<{
  health: unknown | null;
  friction: unknown | null;
  inbox: unknown | null;
  weeklyObjective: unknown | null;
}>;

export type OperatorFocusDto = Readonly<{
  startHere: MobileTodayTaskItem | null;
  queue: MobileTodayTaskItem[];
}>;

export type OperatorScheduleDto = Readonly<{
  blocks: MobileTodayTaskItem[];
  flexible: MobileTodayTaskItem[];
}>;

export type OperatorSnapshotDto = Readonly<{
  ok: true;
  date: string;
  sections: Readonly<{
    planned: MobileTodayTaskItem[];
    inProgress: MobileTodayTaskItem[];
    blocked: MobileTodayTaskItem[];
    completed: MobileTodayTaskItem[];
  }>;
  focus: OperatorFocusDto;
  schedule: OperatorScheduleDto;
  suggestions: Readonly<{
    pinned: MobileTodayTaskItem[];
    inProgress: MobileTodayTaskItem[];
  }>;
  summary: MobileTodaySummary;
  activeTimer: Readonly<{ sessionId: string; taskId: string }> | null;
  signals: OperatorSignalsDto;
}>;

export type GetOperatorSnapshotResponse = OperatorSnapshotDto;

// ---------------------------------------------------------------------------
// Operator proposal lifecycle DTOs — shared wire contracts for explicit
// approval and safe plan application (EGA-518). Application owns authority;
// contracts own shapes.
// ---------------------------------------------------------------------------

export const OPERATOR_PROPOSAL_STATUSES = [
  "generated",
  "revised",
  "approved",
  "applying",
  "applied",
  "partially_applied",
  "stale",
  "dismissed",
] as const;

export type OperatorProposalStatusDto = (typeof OPERATOR_PROPOSAL_STATUSES)[number];

export type OperatorProposalTaskVersionDto = Readonly<{
  id: string;
  updatedAt: string;
  status: string;
  priority: string;
  dueDate: string | null;
  focusRank: number | null;
  estimateMinutes: number | null;
  plannedForDate: string | null;
}>;

export type OperatorProposalResultDto = Readonly<{
  appliedTaskIds: string[];
  skippedTaskIds: Array<{ id: string; reason: string }>;
  failedTaskIds: Array<{ id: string; reason: string }>;
  staleDetected: boolean;
  appliedAt: string;
  status: OperatorProposalStatusDto;
}>;

export type OperatorProposalDto = Readonly<{
  id: string;
  revision: number;
  ownerUserId: string;
  localDate: string;
  timeContextId: string;
  baselineHash: string;
  proposedTaskIds: string[];
  taskVersions: OperatorProposalTaskVersionDto[];
  parentProposalId: string | null;
  idempotencyKey: string;
  status: OperatorProposalStatusDto;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  appliedAt: string | null;
  dismissedAt: string | null;
  result: OperatorProposalResultDto | null;
  aiRef: string | null;
}>;

export type CreateOperatorProposalRequest = Readonly<{
  localDate: string;
  timeContextId: string;
  proposedTaskIds: string[];
  idempotencyKey: string;
  parentProposalId?: string | null;
  aiRef?: string | null;
  timezone?: string;
}>;

export type CreateOperatorProposalResponse = Readonly<{ ok: true; proposal: OperatorProposalDto }>;

export type ReviseOperatorProposalRequest = Readonly<{
  proposedTaskIds: string[];
  idempotencyKey: string;
  aiRef?: string | null;
}>;

export type ReviseOperatorProposalResponse = CreateOperatorProposalResponse;

export type ApproveOperatorProposalResponse = Readonly<{ ok: true; proposal: OperatorProposalDto }>;

export type ApplyOperatorProposalRequest = Readonly<{
  taskIds?: string[];
}>;

export type ApplyOperatorProposalResponse = Readonly<{
  ok: true;
  proposal: OperatorProposalDto;
  appliedTaskIds: string[];
  skippedTaskIds: Array<{ id: string; reason: string }>;
  failedTaskIds: Array<{ id: string; reason: string }>;
}>;

export type DismissOperatorProposalResponse = Readonly<{ ok: true; proposal: OperatorProposalDto }>;

export type GetOperatorProposalResponse = Readonly<{ ok: true; proposal: OperatorProposalDto }>;

export type ListOperatorProposalsResponse = Readonly<{ ok: true; proposals: OperatorProposalDto[] }>;

export type OperatorProposalMutationErrorResponse = Readonly<{
  ok: false;
  error: { code: "VALIDATION" | "NOT_FOUND" | "CONFLICT" | "INTERNAL"; message: string };
}>;

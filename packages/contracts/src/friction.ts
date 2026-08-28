export type FrictionBlockedSignal = Readonly<{
  id: string;
  title: string;
  blockedReason: string | null;
  ageDays: number;
  updatedAt: string;
  projectId: string;
  goalId: string | null;
  status: string;
}>;

export type FrictionStaleTaskSignal = Readonly<{
  id: string;
  title: string;
  ageDays: number;
  updatedAt: string;
  status: string;
  projectId: string;
  goalId: string | null;
}>;

export type FrictionStaleGoalSignal = Readonly<{
  id: string;
  title: string;
  ageDays: number;
  updatedAt: string;
  status: string;
  projectId: string;
}>;

export type FrictionEstimateSignal = Readonly<{
  id: string;
  title: string;
  projectId: string;
  goalId: string | null;
  estimateMinutes: number;
  actualMinutes: number;
  deltaMinutes: number;
  percentError: number;
  severity: "medium" | "high";
  status: "over" | "under" | "exact";
}>;

export type FrictionContextSwitchSignal = Readonly<{
  switchCount: number;
  threshold: number;
  highThreshold: number;
  severity: "none" | "low" | "medium" | "high";
  isFriction: boolean;
  transitionsCount: number;
  distinctTaskCount: number;
  window: { startIso: string; endIso: string };
}>;

export type FrictionRadarResponse = Readonly<{
  ok: true;
  generatedAt: string;
  thresholdDays: number;
  blocked: FrictionBlockedSignal[];
  staleTasks: FrictionStaleTaskSignal[];
  staleGoals: FrictionStaleGoalSignal[];
  estimateSignals: FrictionEstimateSignal[];
  contextSwitch: FrictionContextSwitchSignal;
  evidenceWindow: { startIso: string; endIso: string } | null;
}>;

/**
 * Deterministic stale threshold owned outside UI/transport.
 * Keep in sync with @ega/domain friction constants.
 */
export const FRICTION_STALE_THRESHOLD_DAYS = 7;

export const FRICTION_ESTIMATE_MIN_MEANINGFUL_MINUTES = 5;
export const FRICTION_ESTIMATE_PERCENT_THRESHOLD = 50;
export const FRICTION_ESTIMATE_HIGH_PERCENT_THRESHOLD = 100;
export const FRICTION_CONTEXT_SWITCH_THRESHOLD = 6;
export const FRICTION_CONTEXT_SWITCH_HIGH_THRESHOLD = 10;

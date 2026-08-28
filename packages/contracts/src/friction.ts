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

export type FrictionRadarResponse = Readonly<{
  ok: true;
  generatedAt: string;
  thresholdDays: number;
  blocked: FrictionBlockedSignal[];
  staleTasks: FrictionStaleTaskSignal[];
  staleGoals: FrictionStaleGoalSignal[];
}>;

/**
 * Deterministic stale threshold owned outside UI/transport.
 * Keep in sync with @ega/domain friction constants.
 */
export const FRICTION_STALE_THRESHOLD_DAYS = 7;

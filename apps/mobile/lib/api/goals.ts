/**
 * Mobile goal API — typed wrappers over the @ega/api-client goals surface
 * (PR5 Hono transport contract), bound to the mobile session token.
 *
 *   GET  /api/goals?view=active|archived|all -> GoalsReadModel
 *   POST /api/goals                          -> { ok: true, values }
 *   PATCH /api/goals/:id/status|health|next-step -> { ok: true }
 *   POST /api/goals/:id/archive|unarchive    -> { ok: true }
 *
 * Errors are thrown as `Error` with the server envelope message (see
 * `unwrapApiResult` in `lib/api/ega.ts`).
 */
import type {
  CreateGoalInput,
  GoalFormValues,
  GoalHealth,
  GoalStatus,
  GoalViewFilter,
  GoalsReadModel,
} from '@ega/api-client';
import { getMobileEgaApiClient, unwrapApiResult } from '@/lib/api/ega';

export async function listMobileGoals(
  view?: GoalViewFilter,
): Promise<GoalsReadModel> {
  return unwrapApiResult(await getMobileEgaApiClient().goals.list(view));
}

export async function createMobileGoal(
  input: CreateGoalInput,
): Promise<GoalFormValues> {
  const result = await getMobileEgaApiClient().goals.create(input);
  return unwrapApiResult(result).values;
}

export async function updateMobileGoalStatus(
  goalId: string,
  status: GoalStatus,
): Promise<void> {
  unwrapApiResult(await getMobileEgaApiClient().goals.updateStatus(goalId, status));
}

export async function updateMobileGoalHealth(
  goalId: string,
  health: GoalHealth | null,
): Promise<void> {
  unwrapApiResult(await getMobileEgaApiClient().goals.updateHealth(goalId, health));
}

export async function updateMobileGoalNextStep(
  goalId: string,
  nextStep: string | null,
): Promise<void> {
  unwrapApiResult(await getMobileEgaApiClient().goals.updateNextStep(goalId, nextStep));
}

export async function archiveMobileGoal(goalId: string): Promise<void> {
  unwrapApiResult(await getMobileEgaApiClient().goals.archive(goalId));
}

export async function unarchiveMobileGoal(goalId: string): Promise<void> {
  unwrapApiResult(await getMobileEgaApiClient().goals.unarchive(goalId));
}

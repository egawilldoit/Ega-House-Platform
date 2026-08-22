/**
 * Mobile timer API — typed wrappers over the @ega/api-client timer surface,
 * bound to the mobile session token. The single mobile timer mutation path.
 *
 *   GET  /api/timer/workspace -> TimerWorkspaceState
 *   POST /api/timer/start     -> { ok: true, activeSession }
 *   POST /api/timer/stop      -> { ok: true, sessionId, taskId }
 */
import type {
  TimerStartResponse,
  TimerStopResponse,
  TimerWorkspaceState,
} from '@ega/contracts/mobile';
import { getMobileEgaApiClient, unwrapApiResult } from '@/lib/api/ega';

export async function fetchTimerWorkspace(): Promise<TimerWorkspaceState> {
  return unwrapApiResult(await getMobileEgaApiClient().timer.workspace());
}

export async function startTimerForTask(taskId: string): Promise<TimerStartResponse> {
  return unwrapApiResult(await getMobileEgaApiClient().timer.start(taskId));
}

export async function stopTimerSession(sessionId?: string): Promise<TimerStopResponse> {
  return unwrapApiResult(await getMobileEgaApiClient().timer.stop(sessionId));
}

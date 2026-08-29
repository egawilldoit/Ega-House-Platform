import {
  FRICTION_CONTEXT_SWITCH_HIGH_THRESHOLD,
  FRICTION_CONTEXT_SWITCH_THRESHOLD,
  getFrictionContextSwitchSeverity,
} from "@ega/domain/friction";
import type { FrictionContextSwitchSignal } from "@ega/contracts/friction";

import {
  calculateExecutionEvidenceForWindow,
  type ExecutionEvidenceSessionRow,
  type ExecutionEvidenceWindow,
} from "../shared/execution-evidence";

export type ContextSwitchOptions = Readonly<{
  nowIso?: string;
  includeOpenSessions?: boolean;
}>;

/**
 * Context-switch friction — transitions between different Task ids in
 * canonical ordered sessions.
 *
 * Repeat sessions on the same Task do not count as a switch. Ordering uses
 * canonical execution-evidence deterministic sort: started_at → task_id → id.
 * Window is caller-supplied via EGA-523 time-context (e.g. getLocalDayWindow
 * boundaries). Overlapping window time is not double-counted because
 * execution-evidence clips each session to the window before ordering.
 */
export function getContextSwitchSignal(
  sessions: ExecutionEvidenceSessionRow[],
  window: ExecutionEvidenceWindow,
  options: ContextSwitchOptions = {},
): FrictionContextSwitchSignal {
  const includeOpen = options.includeOpenSessions === true;
  const nowIso = options.nowIso;

  const evidence = calculateExecutionEvidenceForWindow(sessions, window, {
    nowIso,
    includeOpenSessions: includeOpen,
  });

  const transitions = evidence.transitions;
  const distinctTaskCount = new Set(transitions.map((t) => t.taskId)).size;

  let switchCount = 0;
  for (let i = 1; i < transitions.length; i++) {
    if (transitions[i].taskId !== transitions[i - 1].taskId) switchCount += 1;
  }

  const severity = getFrictionContextSwitchSeverity(switchCount);
  const isFriction = severity === "medium" || severity === "high";

  return {
    switchCount,
    threshold: FRICTION_CONTEXT_SWITCH_THRESHOLD,
    highThreshold: FRICTION_CONTEXT_SWITCH_HIGH_THRESHOLD,
    severity,
    isFriction,
    transitionsCount: transitions.length,
    distinctTaskCount,
    window: { startIso: window.startIso, endIso: window.endIso },
  };
}

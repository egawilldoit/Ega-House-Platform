import type postgres from "postgres";

// ── Data types ─────────────────────────────────────────────────────────────

export interface RunRecord {
  id: string;
  project_id: string;
  status: string;
  claimed_by: string | null;
  heartbeat_at: Date | null;
  lease_expires_at: Date | null;
  started_at: Date | null;
  linear_issue_id: string;
  linear_issue_identifier: string | null;
  linear_issue_url: string | null;
  attempt_number: number;
}

// ── Claim outcome — explicit classification ────────────────────────────────

export type ClaimOutcome =
  | { outcome: "CLAIMED"; run: RunRecord }
  | { outcome: "ACTIVE_VALID_LEASE"; reason: string; run: RunRecord }
  | { outcome: "STALE_EXPIRED_LEASE"; reason: string; run: RunRecord }
  | { outcome: "TERMINAL"; reason: string; run: RunRecord }
  | { outcome: "NOT_FOUND"; reason: string }
  | { outcome: "CLAIM_RACE_LOST"; reason: string }
  | { outcome: "UNKNOWN_INCONSISTENT_STATE"; reason: string; run?: RunRecord };

const TERMINAL_STATUSES = new Set([
  "completed",
  "cancelled",
  "failed",
  "stale",
]);

// ── Claim run ──────────────────────────────────────────────────────────────

/**
 * Atomically claim a queued implementation run.
 *
 * Returns an explicit ClaimOutcome — every path is classified so the caller
 * can decide whether to archive, preserve, or stop.
 *
 * Stale-lease detection: if a run is in preparing/running but the lease has
 * expired, it is reported as STALE_EXPIRED_LEASE. The caller must mark it
 * stale and THEN archive the queue message — never archive without first
 * persisting the terminal state.
 */
export async function claimRun(
  db: postgres.Sql<{}>,
  runId: string,
  runnerId: string,
  leaseSeconds: number,
): Promise<ClaimOutcome> {
  // Load current authoritative state
  const existing = await db`
    SELECT
      id, project_id, status, claimed_by,
      heartbeat_at, lease_expires_at, started_at,
      linear_issue_id, linear_issue_identifier,
      linear_issue_url, attempt_number
    FROM automation.implementation_runs
    WHERE id = ${runId}::uuid
  `;

  if (existing.length === 0) {
    return {
      outcome: "NOT_FOUND",
      reason: `run_id ${runId} not found in automation.implementation_runs`,
    };
  }

  const current = existing[0] as RunRecord;

  // Only attempt atomic claim if the row is genuinely claimable
  if (current.status === "queued" && current.claimed_by === null) {
    const rows = await db`
      UPDATE automation.implementation_runs
      SET
        status = 'preparing',
        claimed_by = ${runnerId},
        heartbeat_at = now(),
        lease_expires_at = now() + ${leaseSeconds}::interval(0)::interval,
        started_at = coalesce(started_at, now()),
        updated_at = now()
      WHERE id = ${runId}::uuid
        AND status = 'queued'
        AND claimed_by IS NULL
      RETURNING
        id, project_id, status, claimed_by,
        heartbeat_at, lease_expires_at, started_at,
        linear_issue_id, linear_issue_identifier,
        linear_issue_url, attempt_number
    `;

    if (rows.length > 0) {
      return { outcome: "CLAIMED", run: rows[0] as RunRecord };
    }

    // Atomic claim failed — re-read to classify what changed
    const recheck = await db`
      SELECT
        id, project_id, status, claimed_by,
        heartbeat_at, lease_expires_at, started_at,
        linear_issue_id, linear_issue_identifier,
        linear_issue_url, attempt_number
      FROM automation.implementation_runs
      WHERE id = ${runId}::uuid
    `;

    if (recheck.length === 0) {
      return {
        outcome: "NOT_FOUND",
        reason: "claim race lost — run deleted between read and update",
      };
    }

    return classifyRun(recheck[0] as RunRecord);
  }

  // Not claimable — classify current state
  return classifyRun(current);
}

// ── Classification ─────────────────────────────────────────────────────────

/**
 * Classify the current state of a run without mutating it.
 * Used when the run is not in a claimable state.
 */
function classifyRun(run: RunRecord): ClaimOutcome {
  const status = run.status;
  const claimedBy = run.claimed_by;
  const leaseExpiresAt = run.lease_expires_at;
  const isLeaseExpired =
    leaseExpiresAt !== null && new Date(leaseExpiresAt) < new Date();

  // Terminal states — work is done, message is obsolete
  if (TERMINAL_STATUSES.has(status)) {
    return {
      outcome: "TERMINAL",
      reason: `run status is '${status}'`,
      run,
    };
  }

  // Inconsistent: claimed_by set but still queued
  if (status === "queued" && claimedBy !== null) {
    return {
      outcome: "UNKNOWN_INCONSISTENT_STATE",
      reason: `claimed_by='${claimedBy}' but status='queued'`,
      run,
    };
  }

  // Queued and unclaimed — claim attempt failed transiently
  if (status === "queued" && claimedBy === null) {
    return {
      outcome: "CLAIM_RACE_LOST",
      reason: "run is queued and unclaimed but atomic claim returned zero rows",
    };
  }

  // Preparing or running with an owner
  if ((status === "preparing" || status === "running") && claimedBy) {
    if (isLeaseExpired) {
      return {
        outcome: "STALE_EXPIRED_LEASE",
        reason: `lease expired at ${leaseExpiresAt!.toISOString()} (owner: ${claimedBy})`,
        run,
      };
    }
    return {
      outcome: "ACTIVE_VALID_LEASE",
      reason: `owned by ${claimedBy} with valid lease (expires ${leaseExpiresAt?.toISOString() ?? "N/A"})`,
      run,
    };
  }

  // Preparing/running but no claimed_by — invariant violation
  if ((status === "preparing" || status === "running") && !claimedBy) {
    return {
      outcome: "UNKNOWN_INCONSISTENT_STATE",
      reason: `status='${status}' but claimed_by is null`,
      run,
    };
  }

  // Catch-all: any other unrecognised state
  return {
    outcome: "UNKNOWN_INCONSISTENT_STATE",
    reason: `unexpected combination: status='${status}' claimed_by='${claimedBy}' lease_expires_at='${leaseExpiresAt?.toISOString() ?? "null"}'`,
    run,
  };
}

// ── Mark run stale ─────────────────────────────────────────────────────────

export interface StaleResult {
  ok: boolean;
  reason?: string;
}

/**
 * Atomically mark a stale/abandoned run as 'stale'.
 *
 * Only applies when:
 *   - status is 'preparing' or 'running'
 *   - lease_expires_at is in the past
 *   - status is not already 'stale'
 *
 * Does NOT reset attempt_number.
 * Does NOT clear claimed_by (preserves evidence).
 * Does NOT reclaim the run — a new attempt requires a new row.
 */
export async function markRunStale(
  db: postgres.Sql<{}>,
  runId: string,
  failureCode: string,
): Promise<StaleResult> {
  const rows = await db`
    UPDATE automation.implementation_runs
    SET
      status = 'stale',
      finished_at = now(),
      failure_code = ${failureCode},
      updated_at = now()
    WHERE id = ${runId}::uuid
      AND status IN ('preparing', 'running')
      AND lease_expires_at < now()
      AND status != 'stale'
    RETURNING id
  `;

  if (rows.length === 0) {
    return {
      ok: false,
      reason: `run ${runId} could not be marked stale — not in preparing/running with expired lease, or already stale`,
    };
  }

  return { ok: true };
}

// ── Heartbeat ──────────────────────────────────────────────────────────────

export interface HeartbeatResult {
  ok: boolean;
  reason?: string;
}

/**
 * Extend the execution lease.
 * Returns ok=false if zero rows were updated (lease lost).
 */
export async function extendLease(
  db: postgres.Sql<{}>,
  runId: string,
  runnerId: string,
  leaseSeconds: number,
): Promise<HeartbeatResult> {
  const rows = await db`
    UPDATE automation.implementation_runs
    SET
      heartbeat_at = now(),
      lease_expires_at = now() + ${leaseSeconds}::interval(0)::interval,
      updated_at = now()
    WHERE id = ${runId}::uuid
      AND claimed_by = ${runnerId}
      AND status IN ('preparing', 'running')
    RETURNING id
  `;

  if (rows.length === 0) {
    return {
      ok: false,
      reason: `lease lost — run ${runId} not claimed by ${runnerId} or not in preparing/running state`,
    };
  }

  return { ok: true };
}

// ── Cancel run (used by smoke cleanup) ─────────────────────────────────────

/**
 * Transition a run to a terminal cancelled state.
 * Used by smoke mode to safely clean up a smoke test run.
 */
export async function cancelRun(
  db: postgres.Sql<{}>,
  runId: string,
  runnerId: string,
  reason: string,
): Promise<boolean> {
  const rows = await db`
    UPDATE automation.implementation_runs
    SET
      status = 'cancelled',
      finished_at = now(),
      failure_code = ${reason},
      updated_at = now()
    WHERE id = ${runId}::uuid
      AND claimed_by = ${runnerId}
      AND status IN ('preparing', 'running', 'queued')
    RETURNING id
  `;
  return rows.length > 0;
}

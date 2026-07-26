/**
 * EGA Runner — one durable process for implementation and PR follow-up.
 *
 * Graph:
 * queued → preparing → running → pr_open → repairing ↺ → awaiting_review
 * → ready_to_merge → merged
 *
 * The implementation queue is archived only after a durable post-queue state
 * (including a durable failure) is persisted. Hermes never owns merge truth.
 */

import type postgres from "postgres";
import { loadConfig, type Config } from "./config.js";
import { closeDb, getDb } from "./db.js";
import { insertEvent } from "./event-log.js";
import { executeImplementationSubprocess } from "./implementation-subprocess.js";
import { monitorDuePullRequests } from "./pr-monitor.js";
import { archiveMessage, readMessage, setVisibilityTimeout } from "./queue.js";
import {
  cancelRun,
  claimRun,
  extendLease,
  markRunStale,
  type ClaimOutcome,
} from "./run-lease.js";
import { verifyImplementationRunsSchema } from "./schema-preflight.js";

interface ActiveRun {
  runId: string;
  msgId: bigint;
}

const POST_QUEUE_STATUSES = new Set([
  "pr_open",
  "pr_failed",
  "validation_failed",
  "repairing",
  "awaiting_review",
  "ready_to_merge",
  "needs_human",
  "merged",
  "deployed",
]);

let activeRun: ActiveRun | null = null;
let activeController: AbortController | null = null;
let shuttingDown = false;

async function main(): Promise<void> {
  const config = loadConfig();
  const db = getDb(config);

  console.log(`[ega-runner] Starting ${config.runnerId}`);
  console.log(
    `[ega-runner] Queue=${config.queueName} poll=${config.pollSeconds}s ` +
    `monitor=${config.prMonitorIntervalSeconds}s repairLimit=${config.maxRepairAttempts} ` +
    `autoMerge=${config.autoMerge}`,
  );

  const preflight = await verifyImplementationRunsSchema(db);
  if (!preflight.ok) {
    throw new Error(`Schema preflight failed: ${preflight.missingColumns.join(", ")}`);
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => requestShutdown(signal));
  }

  while (!shuttingDown) {
    try {
      if (!config.smokeMode) {
        await monitorDuePullRequests(db, config);
      }
      await pollImplementationQueue(db, config);
    } catch (error) {
      console.error(`[ega-runner] Loop error: ${error instanceof Error ? error.message : String(error)}`);
      if (!shuttingDown) await sleep(config.pollSeconds * 1_000);
    }
  }

  await closeDb();
  console.log("[ega-runner] Stopped");
}

async function pollImplementationQueue(
  db: postgres.Sql<{}>,
  config: Config,
): Promise<void> {
  if (shuttingDown) return;
  const message = await readMessage(db, config.queueName, config.visibilityTimeoutSeconds);
  if (shuttingDown) return;
  if (!message) {
    if (config.smokeMode) shuttingDown = true;
    else await sleep(config.pollSeconds * 1_000);
    return;
  }

  const runId = typeof message.message.run_id === "string" ? message.message.run_id : null;
  if (!runId) {
    await archiveDurably(db, config.queueName, message.msg_id);
    return;
  }

  const claim = await claimRun(db, runId, config.runnerId, config.leaseSeconds);
  if (shuttingDown) return;
  switch (claim.outcome) {
    case "CLAIMED": {
      activeRun = { runId, msgId: message.msg_id };
      try {
        await insertEvent(db, runId, "run_preparing", {
          runner_id: config.runnerId,
          queue_message_id: Number(message.msg_id),
          read_count: message.read_ct,
          source: "ega_runner",
        });

        const outcome = await withHeartbeat(db, config, runId, async (signal) => {
          if (config.smokeMode) {
            await executeSmokeFlow(db, config, runId, signal);
            return { archiveMessage: true, status: "cancelled" };
          }
          return executeImplementationSubprocess(config, runId, message.message, signal);
        });

        if (outcome.archiveMessage) {
          await archiveDurably(db, config.queueName, message.msg_id);
          console.log(`[ega-runner] Archived message ${message.msg_id} after durable status ${outcome.status}`);
        }
      } catch (error) {
        console.error(`[ega-runner] Run ${runId} failed without archival: ${error instanceof Error ? error.message : String(error)}`);
        await insertEvent(db, runId, "run_error", {
          error: error instanceof Error ? error.message : String(error),
          runner_id: config.runnerId,
          source: "ega_runner",
        }).catch(() => undefined);
      } finally {
        activeRun = null;
      }
      if (config.smokeMode) shuttingDown = true;
      return;
    }

    case "ACTIVE_VALID_LEASE":
    case "CLAIM_RACE_LOST":
      return;

    case "STALE_EXPIRED_LEASE": {
      const stale = await markRunStale(db, runId, "LEASE_EXPIRED");
      if (!stale.ok) return;
      await insertEvent(db, runId, "run_stale", {
        previous_owner: claim.run.claimed_by,
        lease_expired_at: claim.run.lease_expires_at,
        source: "ega_runner",
      });
      await archiveDurably(db, config.queueName, message.msg_id);
      return;
    }

    case "TERMINAL":
    case "NOT_FOUND":
      await archiveDurably(db, config.queueName, message.msg_id);
      return;

    case "UNKNOWN_INCONSISTENT_STATE": {
      const status = (claim as ClaimOutcome & { run?: { status?: string } }).run?.status;
      if (status && POST_QUEUE_STATUSES.has(status)) {
        await archiveDurably(db, config.queueName, message.msg_id);
        return;
      }
      await insertEvent(db, runId, "run_classification_error", {
        reason: claim.reason,
        status: status ?? null,
        source: "ega_runner",
      }).catch(() => undefined);
      return;
    }
  }
}

async function withHeartbeat<T>(
  db: postgres.Sql<{}>,
  config: Config,
  runId: string,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  activeController = controller;
  let heartbeatFailure: Error | null = null;
  let stopped = false;

  const captureFailure = (error: unknown): void => {
    if (stopped || controller.signal.aborted) return;
    heartbeatFailure = error instanceof Error ? error : new Error(String(error));
    controller.abort(heartbeatFailure);
  };

  const beat = async (): Promise<void> => {
    if (stopped || controller.signal.aborted || shuttingDown) return;
    try {
      const lease = await extendLease(db, runId, config.runnerId, config.leaseSeconds);
      if (stopped || controller.signal.aborted || shuttingDown) return;
      if (!lease.ok) {
        captureFailure(new Error(lease.reason ?? "Execution lease lost"));
        return;
      }
      if (activeRun) {
        await setVisibilityTimeout(db, config.queueName, activeRun.msgId, config.visibilityTimeoutSeconds);
      }
    } catch (error) {
      captureFailure(error);
    }
  };

  const timer = setInterval(() => {
    void beat();
  }, config.heartbeatSeconds * 1_000);
  try {
    const result = await work(controller.signal);
    if (controller.signal.aborted) {
      if (heartbeatFailure) throw heartbeatFailure;
      if (controller.signal.reason instanceof Error) throw controller.signal.reason;
      throw new Error(controller.signal.reason ? String(controller.signal.reason) : "Execution aborted");
    }
    return result;
  } finally {
    stopped = true;
    clearInterval(timer);
    if (activeController === controller) activeController = null;
  }
}

async function executeSmokeFlow(
  db: postgres.Sql<{}>,
  config: Config,
  runId: string,
  signal: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  await insertEvent(db, runId, "runner_smoke_started", {
    runner_id: config.runnerId,
    source: "ega_runner",
  });
  await sleep(Math.min(config.heartbeatSeconds, 1) * 1_000);
  throwIfAborted(signal);
  const cancelled = await cancelRun(db, runId, config.runnerId, "SMOKE_TEST_CLEANUP");
  if (!cancelled) throw new Error("Smoke cleanup could not persist cancellation");
  await insertEvent(db, runId, "runner_smoke_completed", {
    runner_id: config.runnerId,
    source: "ega_runner",
  });
}

async function archiveDurably(
  db: postgres.Sql<{}>,
  queueName: string,
  msgId: bigint,
): Promise<void> {
  await archiveMessage(db, queueName, msgId);
}

function requestShutdown(signal: string): void {
  if (shuttingDown) process.exit(1);
  shuttingDown = true;
  activeController?.abort(new Error(`Runner shutdown requested by ${signal}`));
  console.log(
    `[ega-runner] ${signal} received; no new work will be claimed` +
    (activeRun ? `; active run ${activeRun.runId} is being interrupted and will recover through VT/lease semantics` : ""),
  );
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error(signal.reason ? String(signal.reason) : "Execution aborted");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(`[ega-runner] Fatal: ${error instanceof Error ? error.message : String(error)}`);
  closeDb().finally(() => process.exit(1));
});

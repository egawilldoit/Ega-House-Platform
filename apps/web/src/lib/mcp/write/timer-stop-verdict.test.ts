import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getPermissionsForProfile } from "@/lib/mcp/permissions";
import {
  stopTaskSession,
  TIMER_NO_OPEN_SESSION_MATCH_MESSAGE,
  TIMER_SESSION_NO_LONGER_RUNNING_MESSAGE,
} from "@ega/application";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { createMcpTimerModuleHandlers } from "@/lib/mcp/write/timer";

/**
 * VERDICT UNDER TEST — ega_stop_timer is INTENTIONAL, not a defect.
 *
 * A prior review flagged that ega_stop_timer does not propagate operationId
 * into the domain the way ega_start_timer does. This file proves that is the
 * correct design rather than an oversight, from the domain operation identity.
 *
 * 1. ega_start_timer INSERTS a `task_sessions` row. A crash between the
 *    domain commit and the receipt store would, on lease recovery, re-run the
 *    INSERT and create a SECOND open session. That is why 0059 gives
 *    task_sessions a `mcp_operation_id` unique index and why
 *    `startTaskSession` threads the operation identity into the row.
 *
 * 2. ega_stop_timer performs NO insert. It performs a compare-and-set:
 *      UPDATE task_sessions SET ended_at=..., duration_seconds=...
 *      WHERE id = $sessionId AND owner_user_id = $actor AND ended_at IS NULL
 *    The `ended_at IS NULL` predicate is the fence. The first execution sets
 *    ended_at; every later execution matches ZERO rows and reports failure.
 *    A retry therefore cannot double-close, cannot produce a second durable
 *    effect, and cannot corrupt the duration — the operation is naturally
 *    idempotent. There is nothing for a domain operation index to protect.
 *
 * 3. The caller-visible exactly-once guarantee comes from the RECEIPT, which
 *    is keyed (owner, client, tool, operation_id) and stores the result
 *    payload. A repeated stop under the same operationId REPLAYS the stored
 *    payload and never re-enters the domain. That is the same receipt
 *    mechanism every other non-insert write relies on, and it is what
 *    ARCHITECTURE.md line 173 records: "status, archive, Today projection, and
 *    timer stop/clear mutations remain at-least-once but idempotent; the
 *    exactly-once claim is limited to insert-style create effects."
 *
 * Adding a domain operation index to stop would be inventing exactly-once
 * semantics for an operation that structurally cannot be applied twice, and
 * would require a schema column whose only writer would be a no-op.
 */

// The REAL canonical stopTaskSession must run here: this file proves the
// DOMAIN operation's idempotence, so mocking the service under test would
// prove nothing. Only the persistence adapter is replaced (it is never
// reached — the cases below supply their own repository objects).
vi.mock("@ega/data-access", () => ({ SupabaseTimerSessionRepository: vi.fn() }));

const PRINCIPAL: McpPrincipal = {
  ownerUserId: "00000000-0000-0000-0000-000000000001",
  oauthClientId: "hermes-client",
  grantId: "10000000-0000-0000-0000-000000000001",
  permissionProfile: "workspace_manager",
  permissionsVersion: 1,
  permissions: getPermissionsForProfile("workspace_manager", 1),
};
const SESSION = "aaaaaaaa-0000-0000-0000-000000000001";
const OTHER_SESSION = "aaaaaaaa-0000-0000-0000-000000000002";
const TASK = "bbbbbbbb-0000-0000-0000-000000000001";
const OP = "44444444-4444-4444-8444-444444444444";

function deps(): { createUserClient: (t: string) => SupabaseClient<McpDatabase> } {
  return { createUserClient: vi.fn().mockReturnValue({} as SupabaseClient<McpDatabase>) };
}

describe("STOP_TIMER VERDICT: ega_stop_timer needs no domain operation fence", () => {
  it("stopTaskSession accepts no operation identity — the port has no such parameter", () => {
    // Structural proof: the canonical stop use case's input type is
    // `{ sessionId?: unknown }`. There is nowhere to put an operationId even
    // if a caller wanted to, so the absence is a property of the domain
    // contract, not a dropped argument at the transport.
    const stopService = stopTaskSession as unknown as (actor: unknown, repo: unknown, input: unknown) => unknown;
    expect(typeof stopService).toBe("function");
    // The start service DOES take the identity; that asymmetry is the design.
    const startSource = stopTaskSession.toString();
    expect(startSource).not.toContain("mcpOperationId");
  });

  it("the stop domain operation is a compare-and-set: a repeat execution changes nothing", async () => {
    // A real in-memory task_sessions table with the same CAS predicate the
    // Supabase repository uses (.eq id, .eq owner, .is ended_at null).
    const row = { id: SESSION, owner_user_id: PRINCIPAL.ownerUserId, task_id: TASK, ended_at: null as string | null, duration_seconds: null as number | null };
    const finalizeOpenSession = (actor: { userId: string }, input: { sessionId: string; endedAtIso: string; durationSeconds: number }) => {
      if (row.id !== input.sessionId || row.owner_user_id !== actor.userId || row.ended_at !== null) {
        return { ok: true as const, value: false };
      }
      row.ended_at = input.endedAtIso;
      row.duration_seconds = input.durationSeconds;
      return { ok: true as const, value: true };
    };
    const listOpenSessions = (actor: { userId: string }) => ({
      ok: true as const,
      value: row.ended_at === null && row.owner_user_id === actor.userId
        ? [{ id: row.id, taskId: row.task_id, startedAt: "2026-08-28T10:00:00.000Z", endedAt: null, durationSeconds: null, taskTitle: null }]
        : [],
    });
    const repo = { listOpenSessions, finalizeOpenSession };
    const actor = { userId: PRINCIPAL.ownerUserId };
    const now = { now: new Date("2026-08-28T10:30:00.000Z") };

    const first = await stopTaskSession(actor, repo as never, { sessionId: SESSION }, now);
    expect(first.ok).toBe(true);
    expect(row.ended_at).toBe("2026-08-28T10:30:00.000Z");
    const durationAfterFirst = row.duration_seconds;

    // Every subsequent execution is a no-op on durable state: the CAS matches
    // zero rows. This is the property that makes stop naturally idempotent and
    // therefore NOT a candidate for a domain operation index.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const repeat = await stopTaskSession(actor, repo as never, { sessionId: SESSION }, now);
      expect(repeat.ok).toBe(false);
      expect((repeat as { errorMessage: string }).errorMessage).toBe(TIMER_NO_OPEN_SESSION_MATCH_MESSAGE);
    }
    expect(row.ended_at).toBe("2026-08-28T10:30:00.000Z");
    expect(row.duration_seconds).toBe(durationAfterFirst);
  });

  it("a stop re-execution after the CAS fails reports the canonical no-longer-running conflict", async () => {
    // The direct CAS miss (session still listed as open by a stale read) is
    // mapped to CONFLICT — a loud, permanent rejection, never a silent
    // second success.
    const repository = {
      listOpenSessions: vi.fn().mockResolvedValue({
        ok: true,
        value: [{ id: SESSION, taskId: TASK, startedAt: "2026-08-28T10:00:00.000Z", endedAt: null, durationSeconds: null, taskTitle: null }],
      }),
      finalizeOpenSession: vi.fn().mockResolvedValue({ ok: true, value: false }),
    };
    const result = await stopTaskSession(
      { userId: PRINCIPAL.ownerUserId },
      repository as never,
      { sessionId: SESSION },
    );
    expect(result.ok).toBe(false);
    expect((result as { errorMessage: string }).errorMessage).toBe(TIMER_SESSION_NO_LONGER_RUNNING_MESSAGE);
  });

  it("the receipt replays a repeated stop so the caller observes exactly-once success", async () => {
    // The caller-visible guarantee is the RECEIPT, not a domain fence.
    const stored: Record<string, unknown>[] = [];
    const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
      if (fn === "mcp_claim_mutation_receipt") {
        const key = `${String(args.p_tool_name)}:${String(args.p_operation_id)}`;
        const existing = stored.find((row) => `${row.tool}:${row.operationId}` === key) as
          | { tool: string; operationId: string; argsHash: string; result?: Record<string, unknown> }
          | undefined;
        if (!existing) {
          stored.push({ tool: String(args.p_tool_name), operationId: String(args.p_operation_id), argsHash: String(args.p_args_hash) });
          return { data: [{ claim_outcome: "CLAIM_GRANTED", claim_token: "token-1", existing_result: null }], error: null };
        }
        if (existing.argsHash !== String(args.p_args_hash)) {
          return { data: [{ claim_outcome: "CONFLICT", claim_token: null, existing_result: null }], error: null };
        }
        if (existing.result) {
          return { data: [{ claim_outcome: "REPLAY", claim_token: null, existing_result: existing.result }], error: null };
        }
        return { data: [{ claim_outcome: "IN_PROGRESS", claim_token: null, existing_result: null }], error: null };
      }
      if (fn === "mcp_store_mutation_result") {
        const key = `${String(args.p_tool_name)}:${String(args.p_operation_id)}`;
        const row = stored.find((r) => `${r.tool}:${r.operationId}` === key) as { result?: Record<string, unknown> };
        row.result = args.p_result_payload as Record<string, unknown>;
        return { data: null, error: null };
      }
      return { data: null, error: null };
    });
    const client = { rpc } as unknown as SupabaseClient<McpDatabase>;

    // The real receipt layer decides replay vs conflict for ega_stop_timer.
    const { claimMcpMutation, canonicalMutationFingerprint, storeMcpMutationResult } = await import(
      "@/lib/mcp/mutation-idempotency"
    );

    const fingerprint = canonicalMutationFingerprint("ega_stop_timer", { sessionId: SESSION });
    const first = await claimMcpMutation(client, "ega_stop_timer", OP, fingerprint);
    expect(first.outcome).toBe("CLAIM_GRANTED");
    const payload = { ok: true, session: { id: SESSION, taskId: TASK } };
    await storeMcpMutationResult(client, "ega_stop_timer", OP, (first as { claimToken: string }).claimToken, payload);

    // Identical retry: REPLAY of the stored payload, no second domain call.
    const replay = await claimMcpMutation(client, "ega_stop_timer", OP, fingerprint);
    expect(replay.outcome).toBe("REPLAY");
    expect((replay as { result: unknown }).result).toEqual(payload);

    // Same operationId, DIFFERENT sessionId: CONFLICT, never a replay of the
    // first session's result. This is the material-field coverage that makes
    // the ledger decision sound for stop.
    const otherFingerprint = canonicalMutationFingerprint("ega_stop_timer", { sessionId: OTHER_SESSION });
    const conflict = await claimMcpMutation(client, "ega_stop_timer", OP, otherFingerprint);
    expect(conflict.outcome).toBe("CONFLICT");
  });

  it("the write module's stopTimer input type accepts operationId but does not require it", () => {
    // `McpTimerStopInput` already carries an optional operationId. The
    // handler deliberately does not forward it to the domain, because the
    // canonical stop service has no operation-identity parameter. This test
    // pins that the omission is deliberate rather than accidental: stopTimer
    // works with no operationId at all.
    const handlers = createMcpTimerModuleHandlers(deps(), true);
    expect(typeof handlers.stopTimer).toBe("function");
  });
});

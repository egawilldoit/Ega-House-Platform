import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import type { CalendarScanCommit } from "@ega/application/calendar-sync/ports";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseCalendarSyncRepository } from "../src/calendar/repository";

const ACTOR = createAuthenticatedActor("owner-calendar");
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const CLAIM_TOKEN = "22222222-2222-4222-8222-222222222222";
const JOB_TASK_ID = "44444444-4444-4444-8444-444444444444";
const UNCHANGED_TASK_ID = "55555555-5555-4555-8555-555555555555";

const COMMIT: CalendarScanCommit = {
  runId: RUN_ID,
  claimToken: CLAIM_TOKEN,
  expectedCursor: null,
  nextCursor: {
    createdAt: "2026-11-23T10:00:00+00:00",
    taskId: "33333333-3333-4333-8333-333333333333",
  },
  scanComplete: false,
  items: [
    {
      taskId: JOB_TASK_ID,
      outcome: "pending",
      exclusionReason: "archived",
      eventId: "event-1",
      payloadHash: "hash-1",
      errorMessage: "Retrying after an API error.",
    },
    {
      taskId: UNCHANGED_TASK_ID,
      outcome: "unchanged",
      exclusionReason: null,
      eventId: null,
      payloadHash: null,
    },
  ],
  jobs: [
    {
      taskId: JOB_TASK_ID,
      operation: "delete",
      eventId: "event-1",
      generation: 3,
      eventExists: true,
      payloadHash: "hash-1",
      exclusionReason: "archived",
      taskUpdatedAt: "2026-11-23T09:59:00+00:00",
    },
  ],
  nowIso: "2026-11-23T10:01:00+00:00",
};

class FakeCalendarSupabase {
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  async rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args });
    return { data: true, error: null };
  }
}

test("commitScanPage sends snake_case item and job payloads for a nonempty page", async () => {
  const fake = new FakeCalendarSupabase();
  const repository = new SupabaseCalendarSyncRepository(
    fake as unknown as SupabaseClient,
  );

  const result = await repository.commitScanPage(ACTOR, COMMIT);

  assert.equal(result.ok, true);
  assert.equal(fake.rpcCalls.length, 1);
  const call = fake.rpcCalls[0];
  assert.ok(call);
  assert.equal(call.name, "calendar_sync_commit_scan_page");
  assert.deepEqual(call.args, {
    p_run_id: RUN_ID,
    p_claim_token: CLAIM_TOKEN,
    p_expected_cursor_created_at: null,
    p_expected_cursor_task_id: null,
    p_next_cursor_created_at: "2026-11-23T10:00:00+00:00",
    p_next_cursor_task_id: "33333333-3333-4333-8333-333333333333",
    p_scan_complete: false,
    p_items: [
      {
        task_id: JOB_TASK_ID,
        outcome: "pending",
        exclusion_reason: "archived",
        event_id: "event-1",
        payload_hash: "hash-1",
        error_message: "Retrying after an API error.",
      },
      {
        task_id: UNCHANGED_TASK_ID,
        outcome: "unchanged",
        exclusion_reason: null,
        event_id: null,
        payload_hash: null,
        error_message: null,
      },
    ],
    p_jobs: [
      {
        task_id: JOB_TASK_ID,
        operation: "delete",
        calendar_event_id: "event-1",
        generation: 3,
        event_exists: true,
        payload_hash: "hash-1",
        exclusion_reason: "archived",
        task_updated_at: "2026-11-23T09:59:00+00:00",
      },
    ],
    p_now: "2026-11-23T10:01:00+00:00",
  });
});

test("markReconnectRequired fences updates against the loaded credential revision", async () => {
  const filters: Array<{ op: "eq" | "is"; column: string; value: unknown }> = [];
  let updatedPayload: Record<string, unknown> | null = null;
  let matchRow = true;

  const builder = {
    update(payload: Record<string, unknown>) {
      updatedPayload = payload;
      return builder;
    },
    eq(column: string, value: unknown) {
      filters.push({ op: "eq", column, value });
      return builder;
    },
    is(column: string, value: unknown) {
      filters.push({ op: "is", column, value });
      return builder;
    },
    select() {
      return builder;
    },
    async maybeSingle() {
      return { data: matchRow ? { id: "conn-1" } : null, error: null };
    },
  };

  const fakeSupabase = {
    from(table: string) {
      assert.equal(table, "calendar_integration_settings");
      return builder;
    },
  };

  const repository = new SupabaseCalendarSyncRepository(
    fakeSupabase as unknown as SupabaseClient,
  );

  const matched = await repository.markReconnectRequired(ACTOR, {
    ownerUserId: ACTOR.userId,
    expectedUpdatedAt: "2026-11-23T09:00:00.000Z",
    expectedConnectedAt: "2026-11-23T09:00:00.000Z",
    expectedAccessTokenEncrypted: "enc-access-1",
    expectedRefreshTokenEncrypted: "enc-refresh-1",
    message: "Google token revoked.",
    nowIso: "2026-11-23T10:00:00.000Z",
  });
  assert.deepEqual(matched, { ok: true, value: true });
  assert.deepEqual(updatedPayload, {
    reconnect_required_at: "2026-11-23T10:00:00.000Z",
    reconnect_required_reason: "Google token revoked.",
    updated_at: "2026-11-23T10:00:00.000Z",
  });
  assert.deepEqual(filters, [
    { op: "eq", column: "owner_user_id", value: ACTOR.userId },
    { op: "eq", column: "provider", value: "google" },
    { op: "eq", column: "updated_at", value: "2026-11-23T09:00:00.000Z" },
    { op: "eq", column: "connected_at", value: "2026-11-23T09:00:00.000Z" },
    { op: "eq", column: "access_token_encrypted", value: "enc-access-1" },
    { op: "eq", column: "refresh_token_encrypted", value: "enc-refresh-1" },
  ]);

  filters.length = 0;
  matchRow = false;
  const stale = await repository.markReconnectRequired(ACTOR, {
    ownerUserId: ACTOR.userId,
    expectedUpdatedAt: "2026-11-23T09:00:00.000Z",
    expectedConnectedAt: null,
    expectedAccessTokenEncrypted: null,
    expectedRefreshTokenEncrypted: null,
    message: "Google token revoked.",
    nowIso: "2026-11-23T10:00:00.000Z",
  });
  assert.deepEqual(stale, { ok: true, value: false });
  assert.deepEqual(filters, [
    { op: "eq", column: "owner_user_id", value: ACTOR.userId },
    { op: "eq", column: "provider", value: "google" },
    { op: "eq", column: "updated_at", value: "2026-11-23T09:00:00.000Z" },
    { op: "is", column: "connected_at", value: null },
    { op: "is", column: "access_token_encrypted", value: null },
    { op: "is", column: "refresh_token_encrypted", value: null },
  ]);
});

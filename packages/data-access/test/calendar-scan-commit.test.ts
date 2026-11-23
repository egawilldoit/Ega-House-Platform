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

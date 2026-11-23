import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import type { CalendarJobRecord } from "@ega/application/calendar-sync/ports";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseCalendarSyncRepository } from "../src/calendar/repository";

const ACTOR = createAuthenticatedActor("owner-calendar");
const JOB_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const CLAIM_TOKEN = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-11-23T10:10:00+00:00";
const RETRY_AT = "2026-11-23T10:11:00+00:00";

const JOB: CalendarJobRecord = {
  id: JOB_ID,
  ownerUserId: ACTOR.userId,
  taskId: TASK_ID,
  runId: RUN_ID,
  destination: {
    destinationKey: "proof-subject|primary",
    accountSubject: "proof-subject",
    accountEmail: "proof@example.test",
    calendarId: "primary",
  },
  operation: "upsert",
  status: "processing",
  attempts: 1,
  eventId: "event-a",
  generation: 3,
  eventExists: true,
  payloadHash: "hash-a",
  claimToken: CLAIM_TOKEN,
  permanentFailure: false,
  exclusionReason: null,
  lastError: null,
  scheduledAt: NOW,
  taskUpdatedAt: null,
};

class FakeJobUpdate {
  constructor(private readonly fake: FakeCalendarSupabase) {}

  update(values: Record<string, unknown>) {
    this.fake.updateCalls.push(values);
    return this;
  }

  eq() {
    return this;
  }

  select() {
    return this;
  }

  async maybeSingle() {
    return { data: { id: JOB_ID }, error: null };
  }
}

class FakeCalendarSupabase {
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  updateCalls: Array<Record<string, unknown>> = [];

  constructor(private readonly rpcResult: unknown = []) {}

  async rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args });
    return { data: this.rpcResult, error: null };
  }

  from() {
    return new FakeJobUpdate(this);
  }
}

test("releaseJobs settles claims through the queue function without failure fields", async () => {
  const fake = new FakeCalendarSupabase();
  const repository = new SupabaseCalendarSyncRepository(
    fake as unknown as SupabaseClient,
  );

  const result = await repository.releaseJobs(ACTOR, {
    jobIds: [JOB_ID],
    claimToken: CLAIM_TOKEN,
    nowIso: NOW,
  });

  assert.equal(result.ok, true);
  assert.equal(fake.rpcCalls.length, 1);
  assert.deepEqual(fake.rpcCalls[0], {
    name: "calendar_sync_release_claimed_jobs",
    args: {
      p_job_ids: [JOB_ID],
      p_claim_token: CLAIM_TOKEN,
      p_now: NOW,
      p_record_failure: false,
      p_last_error: null,
      p_outcome: null,
      p_exclusion_reason: null,
      p_scheduled_at: null,
    },
  });
  assert.equal(fake.updateCalls.length, 0);
});

test("retryable failJob records the failure and reports the settled claim", async () => {
  const fake = new FakeCalendarSupabase([{ id: JOB_ID }]);
  const repository = new SupabaseCalendarSyncRepository(
    fake as unknown as SupabaseClient,
  );

  const result = await repository.failJob(ACTOR, {
    job: JOB,
    claimToken: CLAIM_TOKEN,
    failure: {
      message: "Transient Google Calendar error.",
      permanent: false,
      retryAt: RETRY_AT,
      outcome: "failed",
      exclusionReason: null,
    },
    nowIso: NOW,
  });

  assert.deepEqual(result, { ok: true, value: true });
  assert.equal(fake.rpcCalls.length, 1);
  assert.deepEqual(fake.rpcCalls[0], {
    name: "calendar_sync_release_claimed_jobs",
    args: {
      p_job_ids: [JOB_ID],
      p_claim_token: CLAIM_TOKEN,
      p_now: NOW,
      p_record_failure: true,
      p_last_error: "Transient Google Calendar error.",
      p_outcome: "failed",
      p_exclusion_reason: null,
      p_scheduled_at: RETRY_AT,
    },
  });
  assert.equal(fake.updateCalls.length, 0);
});

test("retryable failJob reports no settlement when a newer pending edit supersedes it", async () => {
  const fake = new FakeCalendarSupabase([]);
  const repository = new SupabaseCalendarSyncRepository(
    fake as unknown as SupabaseClient,
  );

  const result = await repository.failJob(ACTOR, {
    job: JOB,
    claimToken: CLAIM_TOKEN,
    failure: {
      message: "Transient Google Calendar error.",
      permanent: false,
      retryAt: RETRY_AT,
      outcome: "failed",
      exclusionReason: null,
    },
    nowIso: NOW,
  });

  assert.deepEqual(result, { ok: true, value: false });
  assert.equal(fake.rpcCalls.length, 1);
});

test("permanent failJob does not need the pending slot or the queue function", async () => {
  const fake = new FakeCalendarSupabase();
  const repository = new SupabaseCalendarSyncRepository(
    fake as unknown as SupabaseClient,
  );

  const result = await repository.failJob(ACTOR, {
    job: JOB,
    claimToken: CLAIM_TOKEN,
    failure: {
      message: "The event belongs to another task.",
      permanent: true,
      retryAt: null,
      outcome: "failed",
      exclusionReason: null,
    },
    nowIso: NOW,
  });

  assert.deepEqual(result, { ok: true, value: true });
  assert.equal(fake.rpcCalls.length, 0);
  assert.equal(fake.updateCalls.length, 1);
  assert.equal(fake.updateCalls[0]?.status, "failed");
  assert.equal(fake.updateCalls[0]?.permanent_failure, true);
});

test("completeJob settles the job, confirmed mapping removal and run item atomically", async () => {
  const fake = new FakeCalendarSupabase(true);
  const repository = new SupabaseCalendarSyncRepository(
    fake as unknown as SupabaseClient,
  );

  const result = await repository.completeJob(ACTOR, {
    job: JOB,
    claimToken: CLAIM_TOKEN,
    completion: {
      outcome: "removed",
      eventId: null,
      generation: JOB.generation,
      payloadHash: null,
      exclusionReason: null,
      mappingRemoval: { eventId: "event-a", generation: JOB.generation },
      lastError: null,
      taskSyncStatus: "skipped",
    },
    nowIso: NOW,
  });

  assert.deepEqual(result, { ok: true, value: true });
  assert.equal(fake.rpcCalls.length, 1);
  assert.deepEqual(fake.rpcCalls[0], {
    name: "calendar_sync_complete_job",
    args: {
      p_job_id: JOB_ID,
      p_claim_token: CLAIM_TOKEN,
      p_outcome: "removed",
      p_event_id: null,
      p_generation: JOB.generation,
      p_payload_hash: null,
      p_exclusion_reason: null,
      p_last_error: null,
      p_permanent_failure: false,
      p_remove_mapping: true,
      p_removed_event_id: "event-a",
      p_removed_generation: JOB.generation,
      p_now: NOW,
    },
  });
});

test("completeJob reports no settlement when a stale claim cannot finalize", async () => {
  const fake = new FakeCalendarSupabase(false);
  const repository = new SupabaseCalendarSyncRepository(
    fake as unknown as SupabaseClient,
  );

  const result = await repository.completeJob(ACTOR, {
    job: JOB,
    claimToken: CLAIM_TOKEN,
    completion: {
      outcome: "removed",
      eventId: null,
      generation: JOB.generation,
      payloadHash: null,
      exclusionReason: null,
      mappingRemoval: { eventId: "event-a", generation: JOB.generation },
      taskSyncStatus: "skipped",
    },
    nowIso: NOW,
  });

  assert.deepEqual(result, { ok: true, value: false });
  assert.equal(fake.rpcCalls.length, 1);
  assert.equal(fake.rpcCalls[0]?.name, "calendar_sync_complete_job");
});

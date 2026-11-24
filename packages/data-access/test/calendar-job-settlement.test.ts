import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import type { CalendarJobRecord } from "@ega/application/calendar-sync/ports";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

test("permanent failJob settles through the lease-guarded terminal function", async () => {
  const fake = new FakeCalendarSupabase(true);
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
  assert.deepEqual(fake.rpcCalls, [{
    name: "calendar_sync_fail_claim",
    args: {
      p_job_id: JOB_ID,
      p_claim_token: CLAIM_TOKEN,
      p_outcome: "failed",
      p_exclusion_reason: null,
      p_last_error: "The event belongs to another task.",
      p_permanent: true,
      p_now: NOW,
    },
  }]);
  assert.equal(fake.updateCalls.length, 0);
});

test("ready destination discovery sends owner scope and limit to the database", async () => {
  const supabase = createClient("https://calendar-proof.example", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (url, init) => {
        assert.equal(new URL(String(url)).pathname, "/rest/v1/rpc/calendar_sync_list_ready_destinations");
        assert.deepEqual(JSON.parse(String(init?.body)), { p_owner: ACTOR.userId, p_limit: 5 });
        return Response.json([{
          owner_user_id: ACTOR.userId,
          destination_key: JOB.destination.destinationKey,
          google_account_subject: JOB.destination.accountSubject,
          google_account_email: JOB.destination.accountEmail,
          calendar_id: JOB.destination.calendarId,
        }]);
      },
    },
  });
  const repository = new SupabaseCalendarSyncRepository(supabase);

  assert.deepEqual(await repository.listReadyDestinations(ACTOR, 5), {
    ok: true,
    value: [{ ownerUserId: ACTOR.userId, destination: JOB.destination }],
  });
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

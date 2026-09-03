import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createApp } from "../src/index";

type QueryResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
  count?: number | null;
};

type Call = { table: string; steps: Array<{ method: string; args: unknown[] }> };

/**
 * Route-level coverage for families that previously only had application
 * tests. The fake is intentionally a request-scoped query recorder: tests
 * prove the HTTP status/envelope and the owner predicate without contacting
 * a real Supabase project.
 */
class FakeSupabase {
  private readonly queues = new Map<string, QueryResult[]>();
  readonly calls: Call[] = [];

  from(table: string) {
    return new FakeBuilder(table, this);
  }

  push(table: string, result: QueryResult) {
    const queue = this.queues.get(table) ?? [];
    queue.push(result);
    this.queues.set(table, queue);
  }

  pop(table: string): QueryResult {
    return this.queues.get(table)?.shift() ?? { data: null, error: null, count: 0 };
  }
}

class FakeBuilder {
  private readonly steps: Array<{ method: string; args: unknown[] }> = [];

  constructor(
    private readonly table: string,
    private readonly fake: FakeSupabase,
  ) {}

  select(...args: unknown[]) { return this.step("select", args); }
  insert(...args: unknown[]) { return this.step("insert", args); }
  update(...args: unknown[]) { return this.step("update", args); }
  eq(...args: unknown[]) { return this.step("eq", args); }
  neq(...args: unknown[]) { return this.step("neq", args); }
  in(...args: unknown[]) { return this.step("in", args); }
  lt(...args: unknown[]) { return this.step("lt", args); }
  gte(...args: unknown[]) { return this.step("gte", args); }
  is(...args: unknown[]) { return this.step("is", args); }
  or(...args: unknown[]) { return this.step("or", args); }
  order(...args: unknown[]) { return this.step("order", args); }
  limit(...args: unknown[]) { return this.step("limit", args); }

  maybeSingle(...args: unknown[]) { return this.step("maybeSingle", args); }
  single(...args: unknown[]) { return this.step("single", args); }

  private step(method: string, args: unknown[]) {
    this.steps.push({ method, args });
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    this.fake.calls.push({ table: this.table, steps: this.steps });
    return Promise.resolve(this.fake.pop(this.table)).then(onfulfilled, onrejected);
  }
}

const AUTH = { authorization: "Bearer wave-02-token" };

function operatorRow(status: string, result: unknown = null) {
  return {
    id: "proposal-1",
    revision: 1,
    owner_user_id: "user-wave-02",
    local_date: "2026-08-27",
    time_context_id: "2026-08-27::UTC::2026-08-27T00:00:00.000Z",
    baseline_hash: "baseline-1",
    proposed_task_ids: [],
    task_versions: [],
    parent_proposal_id: null,
    idempotency_key: "proposal-key-1",
    status,
    created_at: "2026-08-27T12:00:00.000Z",
    updated_at: "2026-08-27T12:00:00.000Z",
    approved_at: status === "approved" ? "2026-08-27T12:01:00.000Z" : null,
    applied_at: status === "applied" ? "2026-08-27T12:02:00.000Z" : null,
    dismissed_at: status === "dismissed" ? "2026-08-27T12:02:00.000Z" : null,
    result,
    ai_ref: null,
  };
}

function makeApp(fake: FakeSupabase, now = new Date("2026-08-27T12:00:00.000Z")) {
  return createApp({
    verifyToken: async (token) => (token === "wave-02-token" ? "user-wave-02" : null),
    createRequestClient: () => fake as unknown as SupabaseClient,
    now: () => now,
  });
}

function actorScopedCall(fake: FakeSupabase, table: string) {
  return fake.calls.find(
    (call) =>
      call.table === table &&
      call.steps.some(
        (step) =>
          step.method === "eq" &&
          (step.args[0] === "owner_user_id" || step.args[0] === "user_id"),
      ),
  );
}

test("Wave 02 mounted route families require verified auth", async () => {
  const app = makeApp(new FakeSupabase());

  for (const path of [
    "/api/health/snapshot",
    "/api/operator/proposals",
    "/api/time-context",
    "/api/review",
  ]) {
    const response = await app.request(path);
    assert.equal(response.status, 401, path);
  }
});

test("GET /api/health/snapshot returns the empty contract and scopes evidence", async () => {
  const fake = new FakeSupabase();
  fake.push("task_sessions", { data: [], error: null });

  const response = await makeApp(fake).request("/api/health/snapshot", { headers: AUTH });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.snapshot.sessionCount, 0);
  assert.deepEqual(body.recommendations, []);
  assert.equal(actorScopedCall(fake, "user_time_context")?.steps.find((step) => step.method === "eq")?.args[1], "user-wave-02");
  assert.equal(actorScopedCall(fake, "task_sessions")?.steps.find((step) => step.method === "eq")?.args[1], "user-wave-02");
});

test("GET /api/health/snapshot maps evidence failure to a stable server error", async () => {
  const fake = new FakeSupabase();
  fake.push("task_sessions", { data: null, error: { code: "XX000", message: "database unavailable" } });

  const response = await makeApp(fake).request("/api/health/snapshot", { headers: AUTH });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: { code: "INTERNAL", message: "Unable to load health snapshot right now." },
  });
});

test("GET /api/operator/proposals returns an owner-scoped empty list", async () => {
  const fake = new FakeSupabase();

  const response = await makeApp(fake).request("/api/operator/proposals?limit=10", { headers: AUTH });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, proposals: [] });
  const call = actorScopedCall(fake, "operator_proposals");
  assert.ok(call);
  assert.equal(call.steps.find((step) => step.method === "eq")?.args[1], "user-wave-02");
  assert.deepEqual(call.steps.find((step) => step.method === "limit")?.args, [10]);
});

test("GET /api/operator/proposals/:id maps an unavailable proposal to 404", async () => {
  const fake = new FakeSupabase();

  const response = await makeApp(fake).request("/api/operator/proposals/missing", { headers: AUTH });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: { code: "NOT_FOUND", message: "Proposal not found." },
  });
  assert.ok(actorScopedCall(fake, "operator_proposals"));
});

test("Operator mutation routes preserve missing-proposal 404 semantics", async () => {
  const cases = [
    { path: "/api/operator/proposals/missing/revise", body: { proposedTaskIds: [], idempotencyKey: "revise-1" } },
    { path: "/api/operator/proposals/missing/approve" },
    { path: "/api/operator/proposals/missing/apply", body: {} },
    { path: "/api/operator/proposals/missing/dismiss" },
  ];

  for (const item of cases) {
    const fake = new FakeSupabase();
    const response = await makeApp(fake).request(item.path, {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify(item.body ?? {}),
    });

    assert.equal(response.status, 404, item.path);
    assert.deepEqual(await response.json(), {
      error: { code: "NOT_FOUND", message: "Proposal not found." },
    });
    assert.ok(actorScopedCall(fake, "operator_proposals"), item.path);
  }
});

test("Operator mutation routes map repository failures to 500", async () => {
  const fake = new FakeSupabase();
  fake.push("operator_proposals", { data: null, error: { code: "XX000", message: "database unavailable" } });

  const response = await makeApp(fake).request("/api/operator/proposals/proposal-1/approve", {
    method: "POST",
    headers: AUTH,
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: { code: "INTERNAL", message: "Unable to load proposal." },
  });
});

test("Operator create and revise reject malformed JSON before repository access", async () => {
  for (const path of [
    "/api/operator/proposals",
    "/api/operator/proposals/proposal-1/revise",
    "/api/operator/proposals/proposal-1/apply",
  ]) {
    const fake = new FakeSupabase();
    const response = await makeApp(fake).request(path, {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: "{ malformed",
    });

    assert.equal(response.status, 400, path);
    assert.deepEqual(await response.json(), {
      error: { code: "VALIDATION", message: "Request body must be valid JSON." },
    });
    assert.equal(fake.calls.length, 0, path);
  }
});

test("Operator mutation routes preserve successful proposal envelopes", async () => {
  const createFake = new FakeSupabase();
  createFake.push("operator_proposals", { data: null, error: null });
  createFake.push("operator_proposals", { data: operatorRow("generated"), error: null });
  const createResponse = await makeApp(createFake).request("/api/operator/proposals", {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({ proposedTaskIds: [], idempotencyKey: "proposal-key-1" }),
  });
  assert.equal(createResponse.status, 201);
  assert.equal((await createResponse.json()).proposal.id, "proposal-1");

  const approveFake = new FakeSupabase();
  approveFake.push("operator_proposals", { data: operatorRow("generated"), error: null });
  approveFake.push("operator_proposals", { data: operatorRow("approved"), error: null });
  const approveResponse = await makeApp(approveFake).request("/api/operator/proposals/proposal-1/approve", {
    method: "POST",
    headers: AUTH,
  });
  assert.equal(approveResponse.status, 200);
  assert.equal((await approveResponse.json()).proposal.status, "approved");

  const applyFake = new FakeSupabase();
  applyFake.push("operator_proposals", { data: operatorRow("approved"), error: null });
  applyFake.push("operator_proposals", { data: operatorRow("applying"), error: null });
  applyFake.push("operator_proposals", {
    data: operatorRow("applied", {
      appliedTaskIds: [],
      skippedTaskIds: [],
      failedTaskIds: [],
      staleDetected: false,
      appliedAt: "2026-08-27T12:02:00.000Z",
      status: "applied",
    }),
    error: null,
  });
  const applyResponse = await makeApp(applyFake).request("/api/operator/proposals/proposal-1/apply", {
    method: "POST",
    headers: AUTH,
  });
  assert.equal(applyResponse.status, 200);
  const applyBody = await applyResponse.json();
  assert.equal(applyBody.ok, true);
  assert.equal(applyBody.proposal.id, "proposal-1");
  assert.equal(applyBody.proposal.status, "applied");
  assert.deepEqual(applyBody.appliedTaskIds, []);
  assert.deepEqual(applyBody.skippedTaskIds, []);
  assert.deepEqual(applyBody.failedTaskIds, []);

  const dismissFake = new FakeSupabase();
  dismissFake.push("operator_proposals", { data: operatorRow("generated"), error: null });
  dismissFake.push("operator_proposals", { data: operatorRow("dismissed"), error: null });
  const dismissResponse = await makeApp(dismissFake).request("/api/operator/proposals/proposal-1/dismiss", {
    method: "POST",
    headers: AUTH,
  });
  assert.equal(dismissResponse.status, 200);
  assert.equal((await dismissResponse.json()).proposal.status, "dismissed");
});

test("GET /api/time-context resolves the UTC fallback and supports explicit dates", async () => {
  const fake = new FakeSupabase();

  const response = await makeApp(fake).request("/api/time-context?date=2026-08-24", { headers: AUTH });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.timeContext.localDate, "2026-08-24");
  assert.equal(body.timeContext.timezone, "UTC");
  assert.equal(body.timeContext.fallback, "missing_timezone");
  assert.equal(actorScopedCall(fake, "user_time_context")?.steps.find((step) => step.method === "eq")?.args[1], "user-wave-02");
});

test("GET /api/time-context rejects malformed historical dates before persistence access", async () => {
  const fake = new FakeSupabase();

  const response = await makeApp(fake).request("/api/time-context?date=not-a-date", { headers: AUTH });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: { code: "VALIDATION", message: "Date is invalid. Expected YYYY-MM-DD." },
  });
  assert.equal(fake.calls.length, 0);
});

test("GET /api/review returns the empty review contract with owner-scoped reads", async () => {
  const fake = new FakeSupabase();

  const response = await makeApp(fake).request("/api/review?weekOf=2026-08-24", { headers: AUTH });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.review.savedReview, null);
  assert.deepEqual(body.review.pastReviews, []);
  assert.ok(actorScopedCall(fake, "week_reviews"));
  assert.ok(actorScopedCall(fake, "tasks"));
  assert.ok(actorScopedCall(fake, "task_sessions"));
});

test("GET /api/review rejects an invalid week without querying storage", async () => {
  const fake = new FakeSupabase();

  const response = await makeApp(fake).request("/api/review?weekOf=not-a-date", { headers: AUTH });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: { code: "VALIDATION", message: "Week date is invalid. Expected YYYY-MM-DD." },
  });
  assert.equal(fake.calls.length, 0);
});

test("POST /api/inbox/:id/convert returns the canonical item/task envelope", async () => {
  const fake = new FakeSupabase();
  fake.push("idea_notes", {
    data: {
      id: "idea-1",
      title: "Plan the launch",
      body: "Draft the next steps",
      status: "inbox",
      type: "idea",
      project_id: "project-1",
      priority: "high",
      tags: [],
      created_at: "2026-08-27T10:00:00.000Z",
      updated_at: "2026-08-27T10:00:00.000Z",
      projects: { name: "Launch", slug: "launch" },
    },
    error: null,
  });
  // The deterministic conversion lookup misses, then createTask returns this row.
  fake.push("tasks", { data: null, error: null });
  fake.push("tasks", {
    data: {
      id: "task-from-idea",
      title: "Plan the launch",
      description: "Draft the next steps",
      blocked_reason: null,
      status: "todo",
      priority: "high",
      due_date: null,
      estimate_minutes: null,
      project_id: "project-1",
      goal_id: null,
      planned_for_date: null,
      focus_rank: null,
      scheduled_start_at: null,
      scheduled_end_at: null,
      calendar_sync_enabled: false,
      calendar_reminder_minutes: 10,
      completed_at: null,
      archived_at: null,
      created_at: "2026-08-27T12:00:00.000Z",
      updated_at: "2026-08-27T12:00:00.000Z",
      projects: { name: "Launch", slug: "launch" },
      goals: null,
    },
    error: null,
  });
  fake.push("idea_notes", {
    data: {
      id: "idea-1",
      title: "Plan the launch",
      body: "Draft the next steps",
      status: "converted",
      type: "idea",
      project_id: "project-1",
      priority: "high",
      tags: [],
      created_at: "2026-08-27T10:00:00.000Z",
      updated_at: "2026-08-27T12:00:00.000Z",
      projects: { name: "Launch", slug: "launch" },
    },
    error: null,
  });

  const response = await makeApp(fake).request("/api/inbox/idea-1/convert", {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({}),
  });

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.item.id, "idea-1");
  assert.equal(body.item.status, "converted");
  assert.equal(body.task.id, "task-from-idea");
  assert.equal(body.task.projectId, "project-1");
  const linkCall = fake.calls.find((call) => call.table === "task_external_refs");
  assert.ok(linkCall);
  const linkPayload = linkCall.steps.find((step) => step.method === "insert")?.args[0] as { owner_user_id?: string };
  assert.equal(linkPayload.owner_user_id, "user-wave-02");
});

import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseInboxRepository } from "../src/index";

const ACTOR = createAuthenticatedActor("user-123");
const EXPECTED_INBOX_LIST_LIMIT = 240;

type Result = { data: unknown; error: { code?: string; message?: string } | null };
type Step = { method: string; args: unknown[] };

class FakeSupabase {
  calls: Array<{ table: string; steps: Step[] }> = [];

  from(table: string) {
    return new Builder(table, this);
  }
}

class Builder {
  private readonly steps: Step[] = [];

  constructor(
    private readonly table: string,
    private readonly fake: FakeSupabase,
  ) {}

  select(...args: unknown[]) {
    this.steps.push({ method: "select", args });
    return this;
  }

  eq(...args: unknown[]) {
    this.steps.push({ method: "eq", args });
    return this;
  }

  in(...args: unknown[]) {
    this.steps.push({ method: "in", args });
    return this;
  }

  order(...args: unknown[]) {
    this.steps.push({ method: "order", args });
    return this;
  }

  limit(...args: unknown[]) {
    this.steps.push({ method: "limit", args });
    return this;
  }

  then<TResult1, TResult2>(
    fulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    this.fake.calls.push({ table: this.table, steps: this.steps });
    return Promise.resolve({ data: [], error: null }).then(fulfilled, rejected);
  }
}

test("Inbox list reads are bounded before executing the Supabase query", async () => {
  const fake = new FakeSupabase();
  const repository = new SupabaseInboxRepository(fake as unknown as SupabaseClient);

  const result = await repository.listInboxItems(ACTOR, { view: "active" });

  assert.equal(result.ok, true);
  const request = fake.calls.find((call) => call.table === "idea_notes");
  assert.ok(request, "expected the Inbox list to query idea_notes");

  const limit = request.steps.find((step) => step.method === "limit");
  assert.ok(limit, "Inbox list query must have an explicit row cap");
  assert.deepEqual(limit.args, [EXPECTED_INBOX_LIST_LIMIT]);
});

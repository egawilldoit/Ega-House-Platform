import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseTimeContextRepository } from "../src/time-context/repository";

const ACTOR = createAuthenticatedActor("user-time-ctx");

type QueryResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

class FakeTimeContextSupabase {
  calls: Array<{ table: string; steps: string[] }> = [];
  constructor(private readonly queue: QueryResult[]) {}

  from(table: string) {
    const builder = new FakeBuilder(table, this.queue, this.calls);
    assert.equal(table, "user_time_context");
    return builder;
  }
}

class FakeBuilder {
  private steps: string[] = [];
  constructor(
    private readonly table: string,
    private readonly queue: QueryResult[],
    private readonly calls: Array<{ table: string; steps: string[] }>,
  ) {}

  select(columns: string) {
    this.steps.push(`select:${columns}`);
    return this;
  }

  eq(column: string, value: unknown) {
    this.steps.push(`eq:${column}=${String(value)}`);
    return this;
  }

  maybeSingle() {
    this.steps.push("maybeSingle");
    const result = this.queue.shift() ?? { data: null, error: null };
    this.calls.push({ table: this.table, steps: [...this.steps] });
    return Promise.resolve(result);
  }

  single() {
    this.steps.push("single");
    const result = this.queue.shift() ?? { data: null, error: null };
    this.calls.push({ table: this.table, steps: [...this.steps] });
    return Promise.resolve(result);
  }

  upsert(payload: unknown, options?: unknown) {
    this.steps.push(`upsert:${JSON.stringify(payload)} options:${JSON.stringify(options)}`);
    return this;
  }

  then<TResult1, TResult2>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    this.calls.push({ table: this.table, steps: [...this.steps] });
    const result = this.queue.shift() ?? { data: null, error: null };
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

function repo(fake: FakeTimeContextSupabase) {
  return new SupabaseTimeContextRepository(fake as unknown as SupabaseClient);
}

test("getTimezone returns stored timezone scoped by user_id", async () => {
  const fake = new FakeTimeContextSupabase([{ data: { iana_timezone: "America/New_York" }, error: null }]);
  const result = await repo(fake).getTimezone(ACTOR);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, "America/New_York");
  assert.ok(fake.calls[0].steps.some((s) => s.includes("eq:user_id=user-time-ctx")));
  assert.ok(fake.calls[0].steps.some((s) => s.includes("select:iana_timezone")));
});

test("getTimezone returns null when no row", async () => {
  const fake = new FakeTimeContextSupabase([{ data: null, error: null }]);
  const result = await repo(fake).getTimezone(ACTOR);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, null);
});

test("getTimezone sanitizes errors", async () => {
  const fake = new FakeTimeContextSupabase([{ data: null, error: { code: "PGRST500" } }]);
  const result = await repo(fake).getTimezone(ACTOR);
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.error, { code: "unknown" });
});

test("setTimezone upserts with user_id and onConflict user_id scoped", async () => {
  const fake = new FakeTimeContextSupabase([{ data: { iana_timezone: "Asia/Tokyo" }, error: null }]);
  const result = await repo(fake).setTimezone(ACTOR, "Asia/Tokyo");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, "Asia/Tokyo");
  const step = fake.calls[0].steps.find((s) => s.startsWith("upsert:"));
  assert.ok(step);
  assert.ok(step.includes('"user_id":"user-time-ctx"'));
  assert.ok(step.includes('"iana_timezone":"Asia/Tokyo"'));
  assert.ok(step.includes('"onConflict":"user_id"'));
});

test("setTimezone sanitizes errors", async () => {
  const fake = new FakeTimeContextSupabase([{ data: null, error: { code: "23505" } }]);
  const result = await repo(fake).setTimezone(ACTOR, "UTC");
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.error, { code: "conflict" });
});

test("setTimezone returns unknown when data missing", async () => {
  const fake = new FakeTimeContextSupabase([{ data: null, error: null }]);
  const result = await repo(fake).setTimezone(ACTOR, "UTC");
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.error, { code: "unknown" });
});

test("owner isolation: different actors produce different scoped queries", async () => {
  const actor2 = createAuthenticatedActor("user-other");
  const fake = new FakeTimeContextSupabase([{ data: null, error: null }]);
  await repo(fake).getTimezone(actor2);
  assert.ok(fake.calls[0].steps.some((s) => s.includes("eq:user_id=user-other")));
});

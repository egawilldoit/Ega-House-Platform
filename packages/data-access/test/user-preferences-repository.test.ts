import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import { DEFAULT_USER_PREFERENCES } from "@ega/domain/preferences";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseUserPreferencesRepository } from "../src/preferences/repository";

const ACTOR = createAuthenticatedActor("owner-preferences");

type QueryResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

class FakePreferencesSupabase {
  calls: Array<{ table: string; steps: string[] }> = [];
  rpcCalls: Array<{ name: string; args: unknown }> = [];
  constructor(private readonly queue: QueryResult[]) {}

  rpc(name: string, args: unknown) {
    this.rpcCalls.push({ name, args });
    return new FakeBuilder("user_preferences", this.queue, this.calls, `rpc:${name}`);
  }

  from(table: string) {
    assert.equal(table, "user_preferences");
    return new FakeBuilder(table, this.queue, this.calls);
  }
}

class FakeBuilder implements PromiseLike<QueryResult> {
  private steps: string[] = [];
  constructor(
    private readonly table: string,
    private readonly queue: QueryResult[],
    private readonly calls: Array<{ table: string; steps: string[] }>,
    prefix?: string,
  ) {
    if (prefix) this.steps.push(prefix);
  }

  select(columns: string) {
    this.steps.push(`select:${columns}`);
    return this;
  }

  eq(column: string, value: unknown) {
    this.steps.push(`eq:${column}=${String(value)}`);
    return this;
  }

  private settle(label: string): QueryResult {
    this.steps.push(label);
    const result = this.queue.shift() ?? { data: null, error: null };
    this.calls.push({ table: this.table, steps: [...this.steps] });
    return result;
  }

  maybeSingle() {
    return Promise.resolve(this.settle("maybeSingle"));
  }

  single() {
    return Promise.resolve(this.settle("single"));
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.settle("await")).then(onfulfilled, onrejected);
  }
}

function repo(fake: FakePreferencesSupabase) {
  return new SupabaseUserPreferencesRepository(fake as unknown as SupabaseClient);
}

const STORED_ROW = {
  theme: "dark",
  accent: "violet",
  density: "compact",
  reduced_motion: true,
  launch_page: "today",
  task_layout: "kanban",
  task_open_mode: "full",
};

/** Non-default persisted schedule: every value differs from the defaults. */
const PERSISTED_SCHEDULE = {
  paused: true,
  targets: {
    monday: { work: 450, jobSearch: 60 },
    tuesday: { work: 480, jobSearch: 90 },
    wednesday: { work: 480, jobSearch: 90 },
    thursday: { work: 480, jobSearch: 90 },
    friday: { work: 480, jobSearch: 90 },
    saturday: { work: 240, jobSearch: 0 },
    sunday: { work: 240, jobSearch: 0 },
  },
  guidance: [
    { name: "Deep work", days: ["monday"], start: "09:00", end: "10:30", enabled: true },
  ],
};

test("get reads the owner row scoped by verified user_id", async () => {
  const fake = new FakePreferencesSupabase([{ data: STORED_ROW, error: null }]);
  const result = await repo(fake).get(ACTOR);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, {
      personalOperations: DEFAULT_USER_PREFERENCES.personalOperations,
      jobSearchReference: null,
      theme: "dark",
      accent: "violet",
      density: "compact",
      reducedMotion: true,
      launchPage: "today",
      taskLayout: "kanban",
      taskOpenMode: "full",
    });
  }
  assert.ok(fake.calls[0]?.steps.some((step) => step.includes("eq:user_id=owner-preferences")));
  assert.ok(fake.calls[0]?.steps.some((step) => step.startsWith("select:")));
  assert.ok(fake.calls[0]?.steps.includes("maybeSingle"));
});

test("get maps the top-level job-search reference", async () => {
  const fake = new FakePreferencesSupabase([{
    data: {
      ...STORED_ROW,
      job_search_reference: {
        kind: "task",
        id: "11111111-1111-4111-8111-111111111111",
      },
    },
    error: null,
  }]);
  const result = await repo(fake).get(ACTOR);

  assert.equal(result.ok, true);
  if (!result.ok || !result.value) return;
  assert.deepEqual(result.value.jobSearchReference, {
    kind: "task",
    id: "11111111-1111-4111-8111-111111111111",
  });
  assert.ok(
    fake.calls[0]?.steps.some((step) => step.includes("job_search_reference")),
  );
});

test("get retries without the reference column before 0089 is applied", async () => {
  const fake = new FakePreferencesSupabase([
    {
      data: null,
      error: {
        code: "42703",
        message: 'column "job_search_reference" does not exist',
      },
    },
    { data: STORED_ROW, error: null },
  ]);
  const result = await repo(fake).get(ACTOR);

  assert.equal(result.ok, true);
  if (!result.ok || !result.value) return;
  assert.equal(result.value.jobSearchReference, null);
  assert.equal(result.value.theme, "dark");
  assert.equal(fake.calls.length, 2);
  const firstSelect = fake.calls[0]?.steps.find((step) => step.startsWith("select:")) ?? "";
  const secondSelect = fake.calls[1]?.steps.find((step) => step.startsWith("select:")) ?? "";
  assert.ok(firstSelect.includes("job_search_reference"));
  assert.ok(!secondSelect.includes("job_search_reference"));
});

test("get maps a persisted non-null personal_operations column", async () => {
  const fake = new FakePreferencesSupabase([
    { data: { ...STORED_ROW, personal_operations: PERSISTED_SCHEDULE }, error: null },
  ]);
  const result = await repo(fake).get(ACTOR);

  assert.equal(result.ok, true);
  if (!result.ok || !result.value) return;
  assert.equal(result.value.theme, "dark");
  assert.deepEqual(result.value.personalOperations, PERSISTED_SCHEDULE);
});

test("get returns null when the owner has no row", async () => {
  const fake = new FakePreferencesSupabase([{ data: null, error: null }]);
  const result = await repo(fake).get(ACTOR);

  assert.deepEqual(result, { ok: true, value: null });
});

test("get preserves legacy preferences when the schedule column is missing", async () => {
  for (const error of [
    { code: "42703", message: "column user_preferences.personal_operations does not exist" },
    { code: "PGRST204", message: "Could not find the 'personal_operations' column of 'user_preferences' in the schema cache" },
  ]) {
    const fake = new FakePreferencesSupabase([{ data: null, error }, { data: STORED_ROW, error: null }]);
    const result = await repo(fake).get(ACTOR);
    assert.equal(result.ok && result.value?.theme, "dark");
    assert.equal(result.ok && result.value?.accent, "violet");
    assert.ok(fake.calls[1]?.steps.includes("eq:user_id=owner-preferences"));
    assert.ok(!fake.calls[1]?.steps[0]?.includes("personal_operations"));
  }
});

test("get treats an unapplied additive migration as the documented defaults", async () => {
  const fake = new FakePreferencesSupabase([
    {
      data: null,
      error: {
        code: "PGRST205",
        message: "Could not find the table 'public.user_preferences' in the schema cache",
      },
    },
  ]);
  const result = await repo(fake).get(ACTOR);

  assert.deepEqual(result, { ok: true, value: null });
});

test("get normalizes an unsupported stored value per field", async () => {
  const fake = new FakePreferencesSupabase([
    {
      data: { ...STORED_ROW, theme: "sepia", accent: null, reduced_motion: null },
      error: null,
    },
  ]);
  const result = await repo(fake).get(ACTOR);

  assert.equal(result.ok, true);
  if (!result.ok || !result.value) return;
  assert.equal(result.value.theme, DEFAULT_USER_PREFERENCES.theme);
  assert.equal(result.value.accent, DEFAULT_USER_PREFERENCES.accent);
  assert.equal(result.value.reducedMotion, DEFAULT_USER_PREFERENCES.reducedMotion);
  assert.equal(result.value.density, "compact");
});

test("get sanitizes unexpected errors", async () => {
  const fake = new FakePreferencesSupabase([{ data: null, error: { code: "PGRST500" } }]);
  const result = await repo(fake).get(ACTOR);

  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.error, { code: "unknown" });
});

test("patch sends only requested fields to the owner-scoped RPC", async () => {
  const fake = new FakePreferencesSupabase([{ data: STORED_ROW, error: null }]);
  const result = await repo(fake).patch(ACTOR, { theme: "light" });
  assert.equal(result.ok, true);
  assert.deepEqual(fake.rpcCalls, [
    { name: "patch_user_preferences", args: { patch: { theme: "light" } } },
  ]);
});

test("patch never sends a user or actor id in the payload", async () => {
  const fake = new FakePreferencesSupabase([{ data: STORED_ROW, error: null }]);
  await repo(fake).patch(ACTOR, { theme: "light" });

  const args = fake.rpcCalls[0]?.args as Record<string, unknown>;
  assert.deepEqual(Object.keys(args), ["patch"]);
  assert.equal("userId" in args, false);
  assert.equal("actorId" in args, false);
  const patch = args.patch as Record<string, unknown>;
  assert.equal("userId" in patch, false);
  assert.equal("ownerUserId" in patch, false);
});

test("patch reads the returned composite object", async () => {
  const fake = new FakePreferencesSupabase([
    {
      data: { ...STORED_ROW, theme: "light", personal_operations: PERSISTED_SCHEDULE },
      error: null,
    },
  ]);
  const result = await repo(fake).patch(ACTOR, { theme: "light" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.theme, "light");
  assert.equal(result.value.accent, "violet");
  assert.deepEqual(result.value.personalOperations, PERSISTED_SCHEDULE);
});

test("patch reads a one-element array response", async () => {
  const fake = new FakePreferencesSupabase([
    {
      data: [{ ...STORED_ROW, theme: "light", personal_operations: PERSISTED_SCHEDULE }],
      error: null,
    },
  ]);
  const result = await repo(fake).patch(ACTOR, { theme: "light" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.theme, "light");
  assert.equal(result.value.density, "compact");
  assert.deepEqual(result.value.personalOperations, PERSISTED_SCHEDULE);
});

test("patch treats a null response as failure", async () => {
  for (const data of [null, []]) {
    const fake = new FakePreferencesSupabase([{ data, error: null }]);
    const result = await repo(fake).patch(ACTOR, { theme: "dark" });
    assert.equal(result.ok, false, `data=${JSON.stringify(data)} must fail`);
    if (!result.ok) assert.deepEqual(result.error, { code: "unknown" });
  }
});

test("patch can send the top-level reference independently", async () => {
  const fake = new FakePreferencesSupabase([{ data: STORED_ROW, error: null }]);
  const result = await repo(fake).patch(ACTOR, {
    jobSearchReference: { kind: "task", id: "11111111-1111-4111-8111-111111111111" },
  });
  assert.equal(result.ok, true);
  const step = fake.calls[0]?.steps.find(entry => entry.startsWith("upsert:"));
  assert.ok(step?.includes('"jobSearchReference":{"kind":"task"'));
  assert.ok(!step?.includes('"personalOperations"'));
});

test("patch returns failure when persistence fails", async () => {
  const fake = new FakePreferencesSupabase([{ data: null, error: { code: "23514" } }]);
  assert.equal((await repo(fake).patch(ACTOR, { theme: "dark" })).ok, false);
});

test("a null personal_operations column falls back to defaults and keeps appearance", async () => {
  const fake = new FakePreferencesSupabase([
    { data: { ...STORED_ROW, theme: "light", personal_operations: null }, error: null },
  ]);
  const result = await repo(fake).get(ACTOR);

  assert.equal(result.ok, true);
  if (!result.ok || !result.value) return;
  assert.equal(result.value.theme, "light");
  assert.equal(result.value.accent, "violet");
  assert.equal(result.value.personalOperations.paused, false);
  assert.deepEqual(
    result.value.personalOperations.targets.monday,
    { work: 480, jobSearch: 90 },
  );
  assert.equal(result.value.personalOperations.guidance.length, 7);
});

test("owner isolation: another actor produces a different scoped query", async () => {
  const fake = new FakePreferencesSupabase([{ data: null, error: null }]);
  await repo(fake).get(createAuthenticatedActor("owner-other"));

  assert.ok(fake.calls[0]?.steps.some((step) => step.includes("eq:user_id=owner-other")));
});

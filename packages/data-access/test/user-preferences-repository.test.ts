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
  constructor(private readonly queue: QueryResult[]) {}

  rpc(name: string, args: unknown) {
    assert.equal(name, "patch_user_preferences");
    const builder = new FakeBuilder("user_preferences", this.queue, this.calls);
    builder.upsert(args);
    return builder;
  }

  from(table: string) {
    assert.equal(table, "user_preferences");
    return new FakeBuilder(table, this.queue, this.calls);
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

test("get reads the owner row scoped by verified user_id", async () => {
  const fake = new FakePreferencesSupabase([{ data: STORED_ROW, error: null }]);
  const result = await repo(fake).get(ACTOR);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, {
      personalOperations: DEFAULT_USER_PREFERENCES.personalOperations,
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

test("get returns null when the owner has no row", async () => {
  const fake = new FakePreferencesSupabase([{ data: null, error: null }]);
  const result = await repo(fake).get(ACTOR);

  assert.deepEqual(result, { ok: true, value: null });
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
  const step = fake.calls[0]?.steps.find(entry => entry.startsWith("upsert:"));
  assert.ok(step?.includes('"theme":"light"'));
  assert.ok(!step?.includes('"accent"'));
});

test("patch returns failure when persistence fails", async () => {
  const fake = new FakePreferencesSupabase([{ data: null, error: { code: "23514" } }]);
  assert.equal((await repo(fake).patch(ACTOR, { theme: "dark" })).ok, false);
});

test("patch returns an error when the database returns no row", async () => {
  const fake = new FakePreferencesSupabase([{ data: null, error: null }]);
  const result = await repo(fake).patch(ACTOR, { theme: "dark" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.error, { code: "unknown" });
});

test("owner isolation: another actor produces a different scoped query", async () => {
  const fake = new FakePreferencesSupabase([{ data: null, error: null }]);
  await repo(fake).get(createAuthenticatedActor("owner-other"));

  assert.ok(fake.calls[0]?.steps.some((step) => step.includes("eq:user_id=owner-other")));
});

import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseInboxRepository } from "../src/index";

const ACTOR = createAuthenticatedActor("user-123");

type Result = { data: unknown; error: { code?: string; message?: string } | null };
type Step = { method: string; args: unknown[] };

class FakeSupabase {
  queues = new Map<string, Result[]>();
  calls: Array<{ table: string; steps: Step[] }> = [];
  from(table: string) {
    return new Builder(table, this);
  }
  push(table: string, result: Result) {
    const queue = this.queues.get(table) ?? [];
    queue.push(result);
    this.queues.set(table, queue);
  }
  pop(table: string): Result {
    return this.queues.get(table)?.shift() ?? { data: [], error: null };
  }
}

class Builder {
  steps: Step[] = [];
  constructor(private table: string, private fake: FakeSupabase) {}
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
  is(...args: unknown[]) {
    this.steps.push({ method: "is", args });
    return this;
  }
  or(...args: unknown[]) {
    this.steps.push({ method: "or", args });
    return this;
  }
  contains(...args: unknown[]) {
    this.steps.push({ method: "contains", args });
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
  maybeSingle(...args: unknown[]) {
    this.steps.push({ method: "maybeSingle", args });
    return this;
  }
  single(...args: unknown[]) {
    this.steps.push({ method: "single", args });
    return this;
  }
  insert(...args: unknown[]) {
    this.steps.push({ method: "insert", args });
    return this;
  }
  update(...args: unknown[]) {
    this.steps.push({ method: "update", args });
    return this;
  }
  delete() {
    this.steps.push({ method: "delete", args: [] });
    return this;
  }
  then<TResult1, TResult2>(
    fulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    this.fake.calls.push({ table: this.table, steps: this.steps });
    return Promise.resolve(this.fake.pop(this.table)).then(fulfilled, rejected);
  }
}

function repository(fake: FakeSupabase) {
  return new SupabaseInboxRepository(fake as unknown as SupabaseClient);
}

test("search hardening: comma, parens, quotes, .eq. % _ \\ and control chars are escaped in or filter, owner still scoped", async () => {
  const fake = new FakeSupabase();
  fake.push("idea_notes", { data: [], error: null });

  const injection = `a,b(c)=d.e:g"f'g\\h%i_j\x00\x1f\x7f:`;
  const result = await repository(fake).listInboxItems(ACTOR, { search: injection });

  assert.equal(result.ok, true);
  // Owner filtering must remain
  assert.ok(
    fake.calls[0].steps.some((s) => s.method === "eq" && s.args[0] === "owner_user_id" && s.args[1] === "user-123"),
    "owner filter must remain",
  );
  const orStep = fake.calls[0].steps.find((s) => s.method === "or");
  assert.ok(orStep, "or filter must be used for search");
  const orArg = String((orStep as Step).args[0]);

  // The raw injection substrings must not appear unescaped in the or clause
  // Check that comma is escaped
  assert.ok(orArg.includes("\\,"), "comma must be escaped as \\,");
  assert.ok(orArg.includes("\\("), "opening paren must be escaped");
  assert.ok(orArg.includes("\\)"), "closing paren must be escaped");
  assert.ok(orArg.includes('\\"'), 'double quote must be escaped');
  assert.ok(orArg.includes("\\'"), "single quote must be escaped");
  assert.ok(orArg.includes("\\."), "dot must be escaped");
  assert.ok(orArg.includes("\\="), "equals must be escaped");
  assert.ok(orArg.includes("\\:"), "colon must be escaped");
  assert.ok(orArg.includes("\\%"), "percent must be escaped");
  assert.ok(orArg.includes("\\_"), "underscore must be escaped");
  assert.ok(orArg.includes("\\\\"), "backslash must be escaped");
  // Control chars should be escaped as \x00 etc, not raw
  assert.ok(orArg.includes("\\x00"), "NUL control char must be escaped");
  assert.ok(orArg.includes("\\x1f"), "US control char must be escaped");
  assert.ok(orArg.includes("\\x7f"), "DEL must be escaped");
  // Ensure the unescaped injection pattern does not create extra or conditions
  // Original injection contains `,b` which would split or into 3 conditions if not escaped. Escaped version should keep exactly 2 conditions (title and body)
  // Count unescaped commas not preceded by backslash: should be exactly 1 (separator between title and body)
  const unescapedCommas = (orArg.match(/(?<!\\),/g) ?? []).length;
  assert.equal(unescapedCommas, 1, "only one unescaped comma should separate title and body conditions");
});

test("search hardening: normal search still works and owner filter intact", async () => {
  const fake = new FakeSupabase();
  fake.push("idea_notes", { data: [], error: null });
  const result = await repository(fake).listInboxItems(ACTOR, { search: "hello world" });
  assert.equal(result.ok, true);
  const orStep = fake.calls[0].steps.find((s) => s.method === "or");
  assert.ok(orStep);
  const orArg = String((orStep as Step).args[0]);
  assert.ok(orArg.includes("hello world"), "normal search term should be present");
});

test("search hardening: .eq. injection is escaped not interpreted as operator", async () => {
  const fake = new FakeSupabase();
  fake.push("idea_notes", { data: [], error: null });
  const result = await repository(fake).listInboxItems(ACTOR, { search: ".eq.foo" });
  assert.equal(result.ok, true);
  const orArg = String(fake.calls[0].steps.find((s) => s.method === "or")!.args[0]);
  // If .eq. were not escaped, PostgREST might interpret it as operator; escaped should be \.eq\.
  assert.ok(orArg.includes("\\.eq\\."), ".eq. should be escaped");
});

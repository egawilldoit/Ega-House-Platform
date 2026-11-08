import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { createAuthenticatedActor, listExpenses } from "@ega/application";
import type { ExpenseRepository } from "@ega/application";

const source = readFileSync(resolve(import.meta.dirname, "./page.tsx"), "utf8");

test("money page derives actor from verified user and reads through expense application", () => {
  assert.match(source, /getCurrentUser\(\)/);
  assert.match(source, /createAuthenticatedActor\(user\.id\)/);
  assert.match(source, /listExpenses\(/);
  assert.match(source, /new SupabaseExpenseRepository\(client\)/);
  assert.doesNotMatch(source, /owner_user_id\s*:/);
});

test("money page honors owner timezone and formats stored integer centimes as MAD", () => {
  assert.match(source, /getWebTimeContext\(\)/);
  assert.match(source, /timezone\s*=\s*time\.timezone/);
  assert.match(source, /timeZone:\s*timezone/);
  assert.match(source, /expense\.amountMinor\s*\/\s*100/);
  assert.match(source, /currency:\s*"MAD"/);
  assert.doesNotMatch(source, /Africa\/Casablanca/);
});

test("money ledger has bounded URL pagination and accessible loading failure recovery", () => {
  assert.match(source, /limit:\s*"25"/);
  assert.match(source, /Math\.min\(parsedOffset,\s*100_000\)/);
  assert.match(source, /offset/);
  assert.match(source, /aria-label="Expense pages"/);
  assert.match(source, /role="alert"/);
  assert.match(source, /Retry/);
  assert.match(source, /No expenses yet/);
});

test("page query values succeed through the actual listExpenses parser and repository path", async () => {
  let received: unknown;
  const repository = {
    list: async (_actor: unknown, query: unknown) => {
      received = query;
      return { ok: true as const, value: [] };
    },
  } as unknown as ExpenseRepository;

  const result = await listExpenses(
    createAuthenticatedActor("owner-1"),
    repository,
    { limit: "25", offset: "50" },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(received, {
    limit: 26,
    offset: 50,
    startUtcIso: null,
    endUtcExclusiveIso: null,
  });
});

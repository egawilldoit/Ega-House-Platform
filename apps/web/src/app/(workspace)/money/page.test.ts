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

test("money ledger displays need-vs-want and keeps notes visible beside merchants", () => {
  assert.match(source, /Need or want/);
  assert.match(source, /expense\.needVsWant/);
  assert.match(source, /expense\.merchant\s*\?\?\s*"Expense"/);
  assert.match(source, /expense\.note\s*&&/);
  assert.doesNotMatch(source, /expense\.merchant\s*\?\?\s*expense\.note/);
});

test("money page renders recorded cash and the movement ledger through the shared use cases", () => {
  assert.match(source, /getMoneyState\(/);
  assert.match(source, /listMovements\(/);
  assert.match(source, /new SupabaseMoneyRepository\(client\)/);
  assert.match(source, /MoneyMovementPanel/);
  assert.match(source, /MoneyMovementActions/);
  assert.match(source, /Recorded cash/);
  assert.doesNotMatch(source, /owner_user_id\s*:/);
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

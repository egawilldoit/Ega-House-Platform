import assert from "node:assert/strict";
import test from "node:test";

import { isMissingSupabaseTable } from "./supabase-error";

test("detects missing table errors by code", () => {
  assert.equal(
    isMissingSupabaseTable({ code: "PGRST205", message: "any message" }, "public.task_saved_views"),
    true,
  );
});

test("detects missing table errors by message content", () => {
  assert.equal(
    isMissingSupabaseTable(
      {
        message: "Could not find the table 'public.task_saved_views' in the schema cache",
      },
      "public.task_saved_views",
    ),
    true,
  );
});

test("ignores unrelated errors", () => {
  assert.equal(
    isMissingSupabaseTable(
      {
        code: "23505",
        message: "duplicate key value violates unique constraint",
      },
      "public.task_saved_views",
    ),
    false,
  );
});


import assert from "node:assert/strict";
import { test } from "node:test";
import { validateLocalEnvironment } from "./local-env.cjs";

function valid() {
  return {
    E2E_DISPOSABLE: "local-supabase-v1", E2E_RUN_ID: "ega-e2e-aabbccddeeff",
    E2E_AUTH_BASE_URL: "http://127.0.0.1:3000", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
    DATABASE_URL: "postgresql://postgres:local@127.0.0.1:55322/postgres",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-anon-key-for-test", SUPABASE_SERVICE_ROLE_KEY: "local-service-key-for-test",
  };
}

test("rejects missing identity and every independent nonlocal mutation target", () => {
  assert.deepEqual(validateLocalEnvironment(valid()), valid());
  for (const patch of [
    { E2E_DISPOSABLE: undefined }, { E2E_RUN_ID: "shared-owner" },
    { E2E_AUTH_BASE_URL: "https://www.egawilldoit.online" },
    { E2E_AUTH_BASE_URL: "http://127.0.0.1:3000@evil.example" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" },
    { DATABASE_URL: "postgresql://postgres:local@remote.example:55322/postgres" },
    { DATABASE_URL: "postgresql://postgres:local@127.0.0.1:5432/postgres" },
    { DATABASE_URL: "postgresql://postgres:local@127.0.0.1:55322/postgres?host=remote.example" },
    { DATABASE_URL: "not a database URL" },
    { SUPABASE_SERVICE_ROLE_KEY: "" },
  ]) assert.throws(() => validateLocalEnvironment({ ...valid(), ...patch }));
  assert.throws(() => validateLocalEnvironment(undefined));
});

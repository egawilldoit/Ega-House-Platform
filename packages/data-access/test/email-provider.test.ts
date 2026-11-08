import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ResendEmailProvider,
  SupabaseEmailResolver,
} from "../src/notifications/email-provider";

type FakeSupabaseInput = Readonly<{
  adminEmail?: string | null;
  profilesEmail?: string | null;
  sessionEmail?: string | null;
  adminError?: unknown;
  profilesError?: unknown;
  adminAvailable?: boolean;
}>;

function fakeSupabase(input: FakeSupabaseInput) {
  const calls: { adminIds: string[]; profileIds: string[] } = {
    adminIds: [],
    profileIds: [],
  };

  const admin =
    input.adminAvailable === false
      ? {}
      : {
          async getUserById(id: string) {
            calls.adminIds.push(id);
            if (input.adminError) {
              return { data: { user: null }, error: input.adminError };
            }
            return {
              data: { user: input.adminEmail ? { email: input.adminEmail } : null },
              error: null,
            };
          },
        };

  const client = {
    auth: {
      admin,
      async getUser() {
        return {
          data: { user: input.sessionEmail ? { email: input.sessionEmail } : null },
          error: null,
        };
      },
    },
    from(table: string) {
      assert.equal(table, "profiles");
      const builder = {
        select(_columns: string) {
          return builder;
        },
        eq(column: string, value: string) {
          assert.equal(column, "id");
          calls.profileIds.push(value);
          return builder;
        },
        async maybeSingle() {
          if (input.profilesError) return { data: null, error: input.profilesError };
          return {
            data: input.profilesEmail ? { email: input.profilesEmail } : null,
            error: null,
          };
        },
      };
      return builder;
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

test("SupabaseEmailResolver resolves the owner email through the service admin API", async () => {
  const { client, calls } = fakeSupabase({
    adminEmail: "owner@example.com",
    profilesError: { code: "42P01", message: 'relation "profiles" does not exist' },
  });

  const resolved = await new SupabaseEmailResolver(client).resolve("owner-1");

  assert.deepEqual(resolved, { status: "resolved", email: "owner@example.com" });
  assert.deepEqual(calls.adminIds, ["owner-1"]);
});

test("SupabaseEmailResolver preserves the owner-scoped profiles fallback", async () => {
  const { client, calls } = fakeSupabase({
    adminError: { status: 503, message: "auth unavailable" },
    profilesEmail: "fallback@example.com",
  });

  const resolved = await new SupabaseEmailResolver(client).resolve("owner-2");

  assert.deepEqual(resolved, { status: "resolved", email: "fallback@example.com" });
  assert.deepEqual(calls.profileIds, ["owner-2"]);
});

test("SupabaseEmailResolver never falls back to the service session user", async () => {
  const { client } = fakeSupabase({
    adminEmail: null,
    profilesEmail: null,
    sessionEmail: "service-account@example.com",
  });

  const resolved = await new SupabaseEmailResolver(client).resolve("owner-3");

  assert.deepEqual(resolved, { status: "absent" });
});

test("SupabaseEmailResolver reports unavailable when admin lookup fails and profiles is missing", async () => {
  const { client } = fakeSupabase({
    adminError: { status: 503, message: "auth unavailable" },
    profilesError: { code: "42P01", message: 'relation "profiles" does not exist' },
  });

  const resolved = await new SupabaseEmailResolver(client).resolve("owner-4");

  assert.equal(resolved.status, "unavailable");
});

test("SupabaseEmailResolver reports unavailable for auth-provider failures", async () => {
  for (const adminError of [
    { status: 401, message: "unauthorized" },
    { status: 429, message: "rate limited" },
    { status: 500, message: "internal error" },
    new Error("network timeout"),
  ]) {
    const { client } = fakeSupabase({
      adminError,
      profilesError: { code: "42P01", message: 'relation "profiles" does not exist' },
    });

    const resolved = await new SupabaseEmailResolver(client).resolve("owner-5");
    assert.equal(resolved.status, "unavailable", String(adminError));
  }
});

test("SupabaseEmailResolver treats a permanent missing owner as absent", async () => {
  const { client } = fakeSupabase({
    adminError: { status: 404, message: "User not found" },
    profilesError: { code: "42P01", message: 'relation "profiles" does not exist' },
  });

  const resolved = await new SupabaseEmailResolver(client).resolve("owner-6");

  assert.deepEqual(resolved, { status: "absent" });
});

test("SupabaseEmailResolver treats authoritative no-email as absent", async () => {
  const { client } = fakeSupabase({
    adminEmail: null,
    profilesError: { code: "42P01", message: 'relation "profiles" does not exist' },
  });

  const resolved = await new SupabaseEmailResolver(client).resolve("owner-7");

  assert.deepEqual(resolved, { status: "absent" });
});

test("SupabaseEmailResolver reports unavailable when admin API is absent and profiles is missing", async () => {
  const { client } = fakeSupabase({
    adminAvailable: false,
    profilesError: { code: "42P01", message: 'relation "profiles" does not exist' },
  });

  const resolved = await new SupabaseEmailResolver(client).resolve("owner-8");

  assert.equal(resolved.status, "unavailable");
});

test("authoritative no-email does not let a stale profile override absence", async () => {
  const { client, calls } = fakeSupabase({
    adminEmail: null,
    profilesEmail: "stale@example.com",
  });

  const resolved = await new SupabaseEmailResolver(client).resolve("owner-9");

  assert.deepEqual(resolved, { status: "absent" });
  assert.deepEqual(calls.profileIds, []);
});

test("explicit user_not_found does not let a stale profile override absence", async () => {
  const { client, calls } = fakeSupabase({
    adminError: { status: 404, code: "user_not_found", message: "User not found" },
    profilesEmail: "stale@example.com",
  });

  const resolved = await new SupabaseEmailResolver(client).resolve("owner-10");

  assert.deepEqual(resolved, { status: "absent" });
  assert.deepEqual(calls.profileIds, []);
});

test("ambiguous 400/404/422 errors are unavailable, not missing owner", async () => {
  for (const adminError of [
    { status: 400, message: "Bad request" },
    { status: 404, message: "Not found" },
    { status: 422, message: "Unprocessable entity" },
    { status: 404, message: "route not found" },
  ]) {
    const { client } = fakeSupabase({
      adminError,
      profilesError: { code: "42P01", message: 'relation "profiles" does not exist' },
    });

    const resolved = await new SupabaseEmailResolver(client).resolve("owner-11");
    assert.equal(resolved.status, "unavailable", String(adminError));
  }
});

test("ambiguous errors do not use a stale profile", async () => {
  const { client, calls } = fakeSupabase({
    adminError: { status: 404, message: "Not found" },
    profilesEmail: "stale@example.com",
  });

  const resolved = await new SupabaseEmailResolver(client).resolve("owner-12");

  assert.equal(resolved.status, "unavailable");
  assert.deepEqual(calls.profileIds, []);
});

test("a temporary admin lookup throw still uses a valid owner profile", async () => {
  const { client } = fakeSupabase({
    adminError: new Error("network timeout"),
    profilesEmail: "fallback@example.com",
  });

  const resolved = await new SupabaseEmailResolver(client).resolve("owner-13");

  assert.deepEqual(resolved, { status: "resolved", email: "fallback@example.com" });
});

function resendProvider(error: unknown) {
  return new ResendEmailProvider(
    {
      emails: {
        async send() {
          return { error };
        },
      },
    },
    "from@example.com",
  );
}

const EMAIL = { to: "to@example.com", subject: "subject", html: "<p>body</p>" };

test("ResendEmailProvider classifies retryable transport/status failures as transient", async () => {
  const errors = [
    new Error("Too many requests"),
    { statusCode: 500, message: "Internal server error" },
    { name: "internal_server_error", message: "Internal server error" },
    { name: "rate_limit_exceeded", message: "Too many requests" },
  ];

  for (const error of errors) {
    const result = await resendProvider(error).send(EMAIL);
    assert.equal(result.ok, false, String(error));
    if (!result.ok) assert.equal(result.errorCode, "transient", String(error));
  }
});

test("ResendEmailProvider classifies 4xx validation failures as permanent", async () => {
  const errors = [
    { statusCode: 422, message: "Invalid field 5" },
    { statusCode: 400, message: "Invalid from address" },
    { name: "validation_error", message: "Invalid to address" },
  ];

  for (const error of errors) {
    const result = await resendProvider(error).send(EMAIL);
    assert.equal(result.ok, false, String(error));
    if (!result.ok) assert.equal(result.errorCode, "permanent", String(error));
  }
});

test("ResendEmailProvider reports provider acceptance without claiming delivery", async () => {
  const provider = new ResendEmailProvider(
    {
      emails: {
        async send() {
          return { data: { id: "email-1" } };
        },
      },
    },
    "from@example.com",
  );

  const result = await provider.send(EMAIL);
  assert.deepEqual(result, { ok: true, providerMessageId: "email-1" });
});

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
}>;

function fakeSupabase(input: FakeSupabaseInput) {
  const calls: { adminIds: string[]; profileIds: string[] } = {
    adminIds: [],
    profileIds: [],
  };

  const client = {
    auth: {
      admin: {
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
      },
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

  assert.equal(resolved, "owner@example.com");
  assert.deepEqual(calls.adminIds, ["owner-1"]);
});

test("SupabaseEmailResolver preserves the owner-scoped profiles fallback", async () => {
  const { client, calls } = fakeSupabase({
    adminError: { status: 503, message: "auth unavailable" },
    profilesEmail: "fallback@example.com",
  });

  const resolved = await new SupabaseEmailResolver(client).resolve("owner-2");

  assert.equal(resolved, "fallback@example.com");
  assert.deepEqual(calls.profileIds, ["owner-2"]);
});

test("SupabaseEmailResolver never falls back to the service session user", async () => {
  const { client } = fakeSupabase({
    adminEmail: null,
    profilesEmail: null,
    sessionEmail: "service-account@example.com",
  });

  const resolved = await new SupabaseEmailResolver(client).resolve("owner-3");

  assert.equal(resolved, null);
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

import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";

function requireAdminEnvironment(
  name: "NEXT_PUBLIC_SUPABASE_URL",
): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing env.${name}`);
  }
  return value;
}

function requireSupabaseSecretKey(): string {
  const value =
    process.env.SUPABASE_SECRET_KEY
    ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!value || value.trim() === "") {
    throw new Error(
      "Missing env.SUPABASE_SECRET_KEY or env.SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  return value;
}

export function createAdminClient() {
  return createSupabaseClient<McpDatabase>(
    requireAdminEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
    requireSupabaseSecretKey(),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );
}

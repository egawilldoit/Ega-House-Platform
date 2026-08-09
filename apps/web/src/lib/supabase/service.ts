import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

let supabaseServiceClient: SupabaseClient<Database> | null = null;

function requireServiceEnv(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY") {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required server-only Supabase environment variable: ${name}`);
  }

  return value;
}

export function getSupabaseServiceClient() {
  if (!supabaseServiceClient) {
    supabaseServiceClient = createClient<Database>(
      requireServiceEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireServiceEnv("SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );
  }

  return supabaseServiceClient;
}

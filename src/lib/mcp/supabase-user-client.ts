import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";

type McpClientOptions = {
  auth: {
    persistSession: false;
    autoRefreshToken: false;
    detectSessionInUrl: false;
  };
  global: {
    headers: {
      Authorization: string;
    };
  };
};

export type McpSupabaseClientFactory = (
  supabaseUrl: string,
  publishableKey: string,
  options: McpClientOptions,
) => SupabaseClient<McpDatabase>;

type CreateMcpSupabaseClientOptions = {
  supabaseUrl?: string;
  publishableKey?: string;
  factory?: McpSupabaseClientFactory;
};

const defaultFactory: McpSupabaseClientFactory = (
  supabaseUrl,
  publishableKey,
  options,
) => createClient<McpDatabase>(supabaseUrl, publishableKey, options);

function requireValue(value: string | undefined, label: string): string {
  if (!value || value.trim() === "") {
    throw new Error(`Missing ${label}.`);
  }

  return value;
}

export function createMcpSupabaseClient(
  accessToken: string,
  options: CreateMcpSupabaseClientOptions = {},
): SupabaseClient<McpDatabase> {
  const token = requireValue(accessToken, "MCP access token");
  const supabaseUrl = requireValue(
    options.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
    "env.NEXT_PUBLIC_SUPABASE_URL",
  );
  const publishableKey = requireValue(
    options.publishableKey
      ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    "env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );

  return (options.factory ?? defaultFactory)(supabaseUrl, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
}

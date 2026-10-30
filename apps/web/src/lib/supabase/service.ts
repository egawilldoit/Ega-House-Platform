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

/**
 * Actor provenance for a trusted service-role write.
 *
 * The scoped agent API verifies its bearer token server-side, then calls this
 * with the stable token id and name. The headers are only trusted by the
 * database actor resolver for a `service_role` request, so a product client's
 * authenticated JWT can never spoof them. Never pass values from a request body.
 */
export type ServiceActorContext =
  | { kind: "agent"; agentId: string }
  | { kind: "system" };

const AGENT_ACTOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/;

/**
 * A per-request service client carrying actor provenance. Do not reuse it
 * across requests: the headers identify one verified agent credential. The
 * database snapshots the agent's display name from the token row, so the header
 * never carries presentation text.
 */
export function createActorScopedServiceClient(actor: ServiceActorContext) {
  const headers: Record<string, string> = {};

  if (actor.kind === "agent") {
    const agentId = actor.agentId.trim();
    if (!AGENT_ACTOR_ID_PATTERN.test(agentId)) {
      throw new Error("Invalid agent actor identity.");
    }

    headers["x-ega-actor-kind"] = "agent";
    headers["x-ega-actor-agent-id"] = agentId;
  }

  return createClient<Database>(
    requireServiceEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireServiceEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: { headers },
    },
  );
}

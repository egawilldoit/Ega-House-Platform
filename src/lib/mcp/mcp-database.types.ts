import type { Database, Json } from "@/lib/supabase/database.types";

type McpGrantTable = {
  Row: {
    id: string;
    owner_user_id: string;
    oauth_client_id: string;
    client_name: string | null;
    status: string;
    permission_profile: string;
    permissions: Json;
    permissions_version: number;
    approved_at: string | null;
    revoked_at: string | null;
    last_used_at: string | null;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    owner_user_id: string;
    oauth_client_id: string;
    client_name?: string | null;
    status?: string;
    permission_profile: string;
    permissions?: Json;
    permissions_version?: number;
    approved_at?: string | null;
    revoked_at?: string | null;
    last_used_at?: string | null;
    created_at?: string;
    updated_at?: string;
  };
  Update: {
    id?: string;
    owner_user_id?: string;
    oauth_client_id?: string;
    client_name?: string | null;
    status?: string;
    permission_profile?: string;
    permissions?: Json;
    permissions_version?: number;
    approved_at?: string | null;
    revoked_at?: string | null;
    last_used_at?: string | null;
    created_at?: string;
    updated_at?: string;
  };
  Relationships: [];
};

type IntegrationAuditTable = {
  Row: {
    id: string;
    owner_user_id: string;
    token_id: string | null;
    oauth_client_id: string | null;
    grant_id: string | null;
    action: string;
    resource_type: string | null;
    resource_id: string | null;
    outcome: string;
    ip_address: string | null;
    request_id: string | null;
    tool_name: string | null;
    metadata: Json;
    duration_ms: number | null;
    error_code: string | null;
    created_at: string;
  };
  Insert: {
    id?: string;
    owner_user_id: string;
    token_id?: string | null;
    oauth_client_id?: string | null;
    grant_id?: string | null;
    action: string;
    resource_type?: string | null;
    resource_id?: string | null;
    outcome: string;
    ip_address?: string | null;
    request_id?: string | null;
    tool_name?: string | null;
    metadata?: Json;
    duration_ms?: number | null;
    error_code?: string | null;
    created_at?: string;
  };
  Update: {
    id?: string;
    owner_user_id?: string;
    token_id?: string | null;
    oauth_client_id?: string | null;
    grant_id?: string | null;
    action?: string;
    resource_type?: string | null;
    resource_id?: string | null;
    outcome?: string;
    ip_address?: string | null;
    request_id?: string | null;
    tool_name?: string | null;
    metadata?: Json;
    duration_ms?: number | null;
    error_code?: string | null;
    created_at?: string;
  };
  Relationships: [];
};

type PublicSchema = Database["public"];

export type McpDatabase = Omit<Database, "public"> & {
  public: Omit<PublicSchema, "Tables"> & {
    Tables: PublicSchema["Tables"] & {
      mcp_authorization_grants: McpGrantTable;
      agent_integration_events: IntegrationAuditTable;
    };
  };
};

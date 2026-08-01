-- EGA House MCP OAuth foundation.
--
-- This migration is additive and idempotent. It is intentionally limited to
-- MCP grants and the existing integration audit authority. Core product-table
-- RLS is handled by the separately reviewed read-only policy migration.

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "mcp_authorization_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_user_id" uuid NOT NULL,
  "oauth_client_id" text NOT NULL,
  "resource_uri" text NOT NULL,
  "client_name" text,
  "status" text NOT NULL DEFAULT 'pending',
  "permission_profile" text NOT NULL,
  "permissions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "permissions_version" integer NOT NULL DEFAULT 1,
  "approved_at" timestamptz,
  "revoked_at" timestamptz,
  "last_used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "mcp_authorization_grants_status_check"
    CHECK ("status" IN ('pending', 'active', 'failed', 'revoked')),
  CONSTRAINT "mcp_authorization_grants_profile_check"
    CHECK ("permission_profile" IN ('read_only', 'task_manager', 'delivery_observer')),
  CONSTRAINT "mcp_authorization_grants_resource_uri_check"
    CHECK (
      "resource_uri" ~ '^https://[^?#]+$'
      OR "resource_uri" ~ '^http://(localhost|127\\.0\\.0\\.1|\\[::1\\])(:[0-9]+)?/[^?#]*$'
    ),
  CONSTRAINT "mcp_authorization_grants_permissions_array_check"
    CHECK (jsonb_typeof("permissions") = 'array'),
  CONSTRAINT "mcp_authorization_grants_permissions_version_check"
    CHECK ("permissions_version" > 0),
  CONSTRAINT "mcp_authorization_grants_owner_client_unique"
    UNIQUE ("owner_user_id", "oauth_client_id")
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "mcp_authorization_grants_owner_status_idx"
  ON "mcp_authorization_grants" ("owner_user_id", "status");

CREATE INDEX IF NOT EXISTS "mcp_authorization_grants_client_status_idx"
  ON "mcp_authorization_grants" ("oauth_client_id", "status");

--> statement-breakpoint

ALTER TABLE "mcp_authorization_grants" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mcp_grants_insert_own" ON "mcp_authorization_grants";
DROP POLICY IF EXISTS "mcp_grants_update_own" ON "mcp_authorization_grants";
DROP POLICY IF EXISTS "mcp_grants_select_own" ON "mcp_authorization_grants";
DROP POLICY IF EXISTS "mcp_grants_auth_hook_read" ON "mcp_authorization_grants";

CREATE POLICY "mcp_grants_select_own"
  ON "mcp_authorization_grants"
  FOR SELECT
  TO authenticated
  USING ("owner_user_id" = auth.uid());

-- Supabase Auth needs narrowly scoped read access when issuing or refreshing an
-- OAuth access token. No client role receives INSERT, UPDATE, or DELETE access.
CREATE POLICY "mcp_grants_auth_hook_read"
  ON "mcp_authorization_grants"
  FOR SELECT
  TO supabase_auth_admin
  USING (true);

REVOKE INSERT, UPDATE, DELETE
  ON TABLE "mcp_authorization_grants"
  FROM authenticated, anon;
GRANT SELECT ON TABLE "mcp_authorization_grants" TO authenticated;
GRANT SELECT (
  "owner_user_id",
  "oauth_client_id",
  "resource_uri",
  "status",
  "revoked_at"
) ON TABLE "mcp_authorization_grants" TO supabase_auth_admin;

--> statement-breakpoint

-- Supabase issues the default `authenticated` audience. This Auth Hook changes
-- the audience only for an OAuth token whose user/client pair already has an
-- active EGA grant. Tokens without a matching grant remain unusable by MCP.
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  claims jsonb;
  user_id uuid;
  oauth_client_id text;
  granted_resource_uri text;
BEGIN
  claims := event -> 'claims';
  oauth_client_id := NULLIF(claims ->> 'client_id', '');

  IF NULLIF(event ->> 'user_id', '') IS NULL OR oauth_client_id IS NULL THEN
    RETURN event;
  END IF;

  user_id := (event ->> 'user_id')::uuid;

  SELECT grant_record.resource_uri
    INTO granted_resource_uri
  FROM public.mcp_authorization_grants AS grant_record
  WHERE grant_record.owner_user_id = user_id
    AND grant_record.oauth_client_id = oauth_client_id
    AND grant_record.status = 'active'
    AND grant_record.revoked_at IS NULL
  LIMIT 1;

  IF granted_resource_uri IS NULL THEN
    RETURN event;
  END IF;

  claims := jsonb_set(claims, '{aud}', to_jsonb(granted_resource_uri), true);
  RETURN jsonb_set(event, '{claims}', claims, true);
END;
$$;

GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE
  ON FUNCTION public.custom_access_token_hook(jsonb)
  TO supabase_auth_admin;
REVOKE EXECUTE
  ON FUNCTION public.custom_access_token_hook(jsonb)
  FROM authenticated, anon, public;

--> statement-breakpoint

-- Legacy agent events require token_id. MCP events identify the caller by
-- oauth_client_id and grant_id instead, so token_id must become nullable.
ALTER TABLE "agent_integration_events"
  ALTER COLUMN "token_id" DROP NOT NULL;

ALTER TABLE "agent_integration_events"
  ADD COLUMN IF NOT EXISTS "oauth_client_id" text;

ALTER TABLE "agent_integration_events"
  ADD COLUMN IF NOT EXISTS "grant_id" uuid;

ALTER TABLE "agent_integration_events"
  ADD COLUMN IF NOT EXISTS "request_id" varchar(64);

ALTER TABLE "agent_integration_events"
  ADD COLUMN IF NOT EXISTS "tool_name" varchar(128);

ALTER TABLE "agent_integration_events"
  ADD COLUMN IF NOT EXISTS "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "agent_integration_events"
  ADD COLUMN IF NOT EXISTS "duration_ms" integer;

ALTER TABLE "agent_integration_events"
  ADD COLUMN IF NOT EXISTS "error_code" varchar(64);

--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_integration_events_grant_id_fkey'
  ) THEN
    ALTER TABLE "agent_integration_events"
      ADD CONSTRAINT "agent_integration_events_grant_id_fkey"
      FOREIGN KEY ("grant_id")
      REFERENCES "mcp_authorization_grants"("id")
      ON DELETE SET NULL;
  END IF;
END
$$;

--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_integration_events_actor_check'
  ) THEN
    ALTER TABLE "agent_integration_events"
      ADD CONSTRAINT "agent_integration_events_actor_check"
      CHECK (
        "token_id" IS NOT NULL
        OR ("oauth_client_id" IS NOT NULL AND "grant_id" IS NOT NULL)
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_integration_events_duration_check'
  ) THEN
    ALTER TABLE "agent_integration_events"
      ADD CONSTRAINT "agent_integration_events_duration_check"
      CHECK ("duration_ms" IS NULL OR "duration_ms" >= 0);
  END IF;
END
$$;

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "agent_integration_events_owner_created_idx"
  ON "agent_integration_events" ("owner_user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "agent_integration_events_client_created_idx"
  ON "agent_integration_events" ("oauth_client_id", "created_at" DESC)
  WHERE "oauth_client_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "agent_integration_events_request_id_idx"
  ON "agent_integration_events" ("request_id")
  WHERE "request_id" IS NOT NULL;

--> statement-breakpoint

ALTER TABLE "agent_integration_events" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_events_select_own" ON "agent_integration_events";
CREATE POLICY "agent_events_select_own"
  ON "agent_integration_events"
  FOR SELECT
  TO authenticated
  USING ("owner_user_id" = auth.uid());

DROP POLICY IF EXISTS "agent_events_insert_own" ON "agent_integration_events";
CREATE POLICY "agent_events_insert_own"
  ON "agent_integration_events"
  FOR INSERT
  TO authenticated
  WITH CHECK ("owner_user_id" = auth.uid());

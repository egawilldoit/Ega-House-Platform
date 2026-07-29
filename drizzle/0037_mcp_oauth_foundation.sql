-- EGA House MCP OAuth foundation.
--
-- This migration is additive and idempotent. It is intentionally limited to
-- MCP grants and the existing integration audit authority. Core product-table
-- RLS is handled by a separately reviewed migration after policy compatibility
-- is proven against the current web and mobile access paths.

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "mcp_authorization_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_user_id" uuid NOT NULL,
  "oauth_client_id" text NOT NULL,
  "client_name" text,
  "status" text NOT NULL DEFAULT 'pending',
  "permission_profile" text NOT NULL,
  "permissions" jsonb NOT NULL DEFAULT '{}'::jsonb,
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

DROP POLICY IF EXISTS "mcp_grants_select_own" ON "mcp_authorization_grants";
CREATE POLICY "mcp_grants_select_own"
  ON "mcp_authorization_grants"
  FOR SELECT
  TO authenticated
  USING ("owner_user_id" = auth.uid());

DROP POLICY IF EXISTS "mcp_grants_insert_own" ON "mcp_authorization_grants";
CREATE POLICY "mcp_grants_insert_own"
  ON "mcp_authorization_grants"
  FOR INSERT
  TO authenticated
  WITH CHECK ("owner_user_id" = auth.uid());

DROP POLICY IF EXISTS "mcp_grants_update_own" ON "mcp_authorization_grants";
CREATE POLICY "mcp_grants_update_own"
  ON "mcp_authorization_grants"
  FOR UPDATE
  TO authenticated
  USING ("owner_user_id" = auth.uid())
  WITH CHECK ("owner_user_id" = auth.uid());

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

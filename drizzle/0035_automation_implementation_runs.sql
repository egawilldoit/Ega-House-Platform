-- EGA House Automation Schema
-- Additive compatibility migration for the existing production schema.
--
-- The automation schema, webhook_deliveries, implementation_runs,
-- implementation_events, implementation_artifacts, and the pgmq queue
-- already exist in production via manual/supabase setup.
--
-- This migration only adds columns that the Runner requires but that do
-- not yet exist in the deployed schema.

--> statement-breakpoint

-- ── Ensure automation schema exists ─────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS "automation";

--> statement-breakpoint

-- ── Implementation runs: add missing Runner-required columns ────────────────
-- The table already exists; only add columns that may be missing.

ALTER TABLE "automation"."implementation_runs" ADD COLUMN IF NOT EXISTS "parent_issue_id" varchar(256);
ALTER TABLE "automation"."implementation_runs" ADD COLUMN IF NOT EXISTS "parent_issue_identifier" varchar(64);

ALTER TABLE "automation"."implementation_runs" ADD COLUMN IF NOT EXISTS "context_hash" varchar(64);
ALTER TABLE "automation"."implementation_runs" ADD COLUMN IF NOT EXISTS "result_json" jsonb;
ALTER TABLE "automation"."implementation_runs" ADD COLUMN IF NOT EXISTS "pr_head_sha" varchar(64);
ALTER TABLE "automation"."implementation_runs" ADD COLUMN IF NOT EXISTS "vercel_preview_url" varchar(512);
ALTER TABLE "automation"."implementation_runs" ADD COLUMN IF NOT EXISTS "vercel_production_sha" varchar(64);
ALTER TABLE "automation"."implementation_runs" ADD COLUMN IF NOT EXISTS "slack_thread_ts" varchar(32);
ALTER TABLE "automation"."implementation_runs" ADD COLUMN IF NOT EXISTS "github_check_run_id" bigint;

--> statement-breakpoint

-- ── Indexes for new columns ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "implementation_runs_context_hash_idx"
  ON "automation"."implementation_runs" USING btree ("context_hash");
CREATE INDEX IF NOT EXISTS "implementation_runs_pr_head_sha_idx"
  ON "automation"."implementation_runs" USING btree ("pr_head_sha");

--> statement-breakpoint

-- ── Updated_at trigger ───────────────────────────────────────────────────────
-- Safe to re-run; OR REPLACE makes this idempotent.
CREATE OR REPLACE FUNCTION "automation"."set_updated_at"()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'implementation_runs_updated_at'
      AND tgrelid = 'automation.implementation_runs'::regclass
  ) THEN
    CREATE TRIGGER "implementation_runs_updated_at"
      BEFORE UPDATE ON "automation"."implementation_runs"
      FOR EACH ROW
      EXECUTE FUNCTION "automation"."set_updated_at"();
  END IF;
END;
$$;

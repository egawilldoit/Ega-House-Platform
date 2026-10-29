-- Archive centre (EGA-797): one archive representation for projects and goals.
--
-- Reconciliation, not a second lifecycle field. Tasks already encode archival
-- as metadata (`archived_at` / `archived_by`) while projects and goals encoded
-- it as a value of the lifecycle `status` column. This migration keeps the
-- existing `status = 'archived'` marker (every current reader, RPC and client
-- depends on it), adds the missing archival metadata, and makes the two
-- representations equivalent by a table CHECK constraint. `status` is the
-- marker; `archived_at` is the timestamp the archive centre orders by and
-- `archived_by` is its attribution. They cannot disagree: any writer that sets
-- one without the other is rejected by the database.
--
-- Backfill: the legacy marker never stored when the row was archived, so
-- `updated_at` (the instant the archive UPDATE wrote) is the only honest
-- timestamp. `archived_by` is the owner, because RLS only ever allowed the
-- owner to perform that write. Rows whose marker was stored with different
-- spelling/casing are normalised to the canonical `'archived'` value before
-- the constraint is added.
--
-- RLS: no new table and no new policy. The new columns are governed by the
-- existing owner-scoped policies (`projects_*`, `goals_*` from 0041/0051),
-- which already require `owner_user_id = (SELECT auth.uid())`; the proof
-- script asserts cross-owner reads/writes stay denied.

ALTER TABLE "public"."projects" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "public"."projects" ADD COLUMN IF NOT EXISTS "archived_by" uuid;
--> statement-breakpoint
ALTER TABLE "public"."goals" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "public"."goals" ADD COLUMN IF NOT EXISTS "archived_by" uuid;
--> statement-breakpoint
UPDATE "public"."projects"
SET "status" = 'archived',
    "archived_at" = COALESCE("archived_at", "updated_at"),
    "archived_by" = COALESCE("archived_by", "owner_user_id")
WHERE lower(btrim("status")) = 'archived';
--> statement-breakpoint
UPDATE "public"."goals"
SET "status" = 'archived',
    "archived_at" = COALESCE("archived_at", "updated_at"),
    "archived_by" = COALESCE("archived_by", "owner_user_id")
WHERE lower(btrim("status")) = 'archived';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_owner_user_id_archived_at_idx" ON "public"."projects" USING btree ("owner_user_id","archived_at" DESC) WHERE "archived_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goals_owner_user_id_archived_at_idx" ON "public"."goals" USING btree ("owner_user_id","archived_at" DESC) WHERE "archived_at" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "public"."projects" DROP CONSTRAINT IF EXISTS "projects_archive_state_check";
--> statement-breakpoint
ALTER TABLE "public"."projects" ADD CONSTRAINT "projects_archive_state_check" CHECK (("archived_at" IS NOT NULL) = ("status" = 'archived'));
--> statement-breakpoint
ALTER TABLE "public"."goals" DROP CONSTRAINT IF EXISTS "goals_archive_state_check";
--> statement-breakpoint
ALTER TABLE "public"."goals" ADD CONSTRAINT "goals_archive_state_check" CHECK (("archived_at" IS NOT NULL) = ("status" = 'archived'));

ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "archived_by" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_owner_active_updated_idx"
  ON "tasks" USING btree ("owner_user_id", "updated_at" DESC)
  WHERE "archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_owner_archived_updated_idx"
  ON "tasks" USING btree ("owner_user_id", "archived_at" DESC)
  WHERE "archived_at" IS NOT NULL;

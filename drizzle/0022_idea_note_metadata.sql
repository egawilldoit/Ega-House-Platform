ALTER TABLE "idea_notes"
  ADD COLUMN IF NOT EXISTS "type" text DEFAULT 'idea' NOT NULL,
  ADD COLUMN IF NOT EXISTS "project_id" uuid,
  ADD COLUMN IF NOT EXISTS "priority" text,
  ADD COLUMN IF NOT EXISTS "tags" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "idea_notes"
  DROP CONSTRAINT IF EXISTS "idea_notes_type_check",
  ADD CONSTRAINT "idea_notes_type_check"
    CHECK ("type" in ('idea', 'feature', 'bug', 'improvement', 'research'));
--> statement-breakpoint
ALTER TABLE "idea_notes"
  DROP CONSTRAINT IF EXISTS "idea_notes_priority_check",
  ADD CONSTRAINT "idea_notes_priority_check"
    CHECK ("priority" is null or "priority" in ('low', 'medium', 'high', 'urgent'));
--> statement-breakpoint
ALTER TABLE "idea_notes"
  DROP CONSTRAINT IF EXISTS "idea_notes_tags_no_nulls",
  ADD CONSTRAINT "idea_notes_tags_no_nulls"
    CHECK (array_position("tags", NULL::text) is null);
--> statement-breakpoint
ALTER TABLE "idea_notes"
  DROP CONSTRAINT IF EXISTS "idea_notes_project_id_projects_id_fk",
  ADD CONSTRAINT "idea_notes_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idea_notes_owner_type_created_idx"
  ON "idea_notes" USING btree ("owner_user_id", "type", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idea_notes_owner_priority_created_idx"
  ON "idea_notes" USING btree ("owner_user_id", "priority", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idea_notes_tags_gin_idx"
  ON "idea_notes" USING gin ("tags");
--> statement-breakpoint
DROP POLICY IF EXISTS "idea_notes_insert_own" ON "idea_notes";
--> statement-breakpoint
DROP POLICY IF EXISTS "idea_notes_update_own" ON "idea_notes";
--> statement-breakpoint
CREATE POLICY "idea_notes_insert_own"
ON "idea_notes"
FOR INSERT
TO authenticated
WITH CHECK (
  owner_user_id = auth.uid()
  AND (
    "idea_notes"."project_id" IS NULL
    OR EXISTS (
      SELECT 1
      FROM "projects"
      WHERE "projects"."id" = "idea_notes"."project_id"
        AND "projects"."owner_user_id" = auth.uid()
    )
  )
);
--> statement-breakpoint
CREATE POLICY "idea_notes_update_own"
ON "idea_notes"
FOR UPDATE
TO authenticated
USING (owner_user_id = auth.uid())
WITH CHECK (
  owner_user_id = auth.uid()
  AND (
    "idea_notes"."project_id" IS NULL
    OR EXISTS (
      SELECT 1
      FROM "projects"
      WHERE "projects"."id" = "idea_notes"."project_id"
        AND "projects"."owner_user_id" = auth.uid()
    )
  )
);

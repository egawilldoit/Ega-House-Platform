CREATE TABLE IF NOT EXISTS "idea_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_user_id" uuid DEFAULT auth.uid() NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "status" text DEFAULT 'inbox' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "idea_notes_title_not_blank" CHECK (length(btrim("title")) > 0),
  CONSTRAINT "idea_notes_status_check" CHECK ("status" in ('inbox'))
);
--> statement-breakpoint
CREATE INDEX "idea_notes_owner_status_created_idx" ON "idea_notes" USING btree ("owner_user_id", "status", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "idea_notes_owner_updated_idx" ON "idea_notes" USING btree ("owner_user_id", "updated_at" DESC);
--> statement-breakpoint
ALTER TABLE "idea_notes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "idea_notes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "idea_notes_select_own" ON "idea_notes";
--> statement-breakpoint
DROP POLICY IF EXISTS "idea_notes_insert_own" ON "idea_notes";
--> statement-breakpoint
DROP POLICY IF EXISTS "idea_notes_update_own" ON "idea_notes";
--> statement-breakpoint
DROP POLICY IF EXISTS "idea_notes_delete_own" ON "idea_notes";
--> statement-breakpoint
CREATE POLICY "idea_notes_select_own"
ON "idea_notes"
FOR SELECT
TO authenticated
USING (owner_user_id = auth.uid());
--> statement-breakpoint
CREATE POLICY "idea_notes_insert_own"
ON "idea_notes"
FOR INSERT
TO authenticated
WITH CHECK (owner_user_id = auth.uid());
--> statement-breakpoint
CREATE POLICY "idea_notes_update_own"
ON "idea_notes"
FOR UPDATE
TO authenticated
USING (owner_user_id = auth.uid())
WITH CHECK (owner_user_id = auth.uid());
--> statement-breakpoint
CREATE POLICY "idea_notes_delete_own"
ON "idea_notes"
FOR DELETE
TO authenticated
USING (owner_user_id = auth.uid());

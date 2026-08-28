-- Fast capture idempotency: dedicated per-owner dedup table for Inbox create.
-- Used by POST /api/inbox with X-Idempotency-Key to ensure retry safety (EGA-506).
-- Unique (owner_user_id, key) guarantees a repeated request with the same key
-- never creates a second idea_notes row; the server returns the original.
CREATE TABLE IF NOT EXISTS "inbox_idempotency_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_user_id" uuid DEFAULT auth.uid() NOT NULL,
  "key" varchar(128) NOT NULL,
  "inbox_item_id" uuid NOT NULL REFERENCES "idea_notes"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "inbox_idempotency_keys_key_not_blank" CHECK (length(btrim("key")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inbox_idempotency_keys_owner_key_unique" ON "inbox_idempotency_keys" USING btree ("owner_user_id", "key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_idempotency_keys_owner_idx" ON "inbox_idempotency_keys" USING btree ("owner_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_idempotency_keys_inbox_item_id_idx" ON "inbox_idempotency_keys" USING btree ("inbox_item_id");
--> statement-breakpoint
ALTER TABLE "inbox_idempotency_keys" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inbox_idempotency_keys" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "inbox_idempotency_keys_select_own" ON "inbox_idempotency_keys";
--> statement-breakpoint
DROP POLICY IF EXISTS "inbox_idempotency_keys_insert_own" ON "inbox_idempotency_keys";
--> statement-breakpoint
DROP POLICY IF EXISTS "inbox_idempotency_keys_delete_own" ON "inbox_idempotency_keys";
--> statement-breakpoint
CREATE POLICY "inbox_idempotency_keys_select_own"
ON "inbox_idempotency_keys"
FOR SELECT
TO authenticated
USING (owner_user_id = auth.uid());
--> statement-breakpoint
CREATE POLICY "inbox_idempotency_keys_insert_own"
ON "inbox_idempotency_keys"
FOR INSERT
TO authenticated
WITH CHECK (owner_user_id = auth.uid());
--> statement-breakpoint
CREATE POLICY "inbox_idempotency_keys_delete_own"
ON "inbox_idempotency_keys"
FOR DELETE
TO authenticated
USING (owner_user_id = auth.uid());

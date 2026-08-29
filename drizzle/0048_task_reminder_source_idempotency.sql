-- Task reminder idempotency for Smart Inbox conversion (EGA-507 repair)
-- Adds exact correlation columns so retry never duplicates or loses side effect.
-- Required invariant: successful conversion ⇒ Task exactly once AND link exactly once AND (if reminder requested) reminder exactly once AND status converted.
-- Uses source=smart_inbox_conversion, source_id=inboxItemId with DB uniqueness, not approximate timestamp.
ALTER TABLE "task_reminders" ADD COLUMN IF NOT EXISTS "source" varchar(64);
--> statement-breakpoint
ALTER TABLE "task_reminders" ADD COLUMN IF NOT EXISTS "source_id" varchar(256);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_reminders_owner_source_source_id_unique" ON "task_reminders" USING btree ("owner_user_id", "source", "source_id") WHERE "source" IS NOT NULL AND "source_id" IS NOT NULL;

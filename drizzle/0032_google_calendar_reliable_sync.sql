ALTER TABLE "calendar_integration_settings" ADD COLUMN "calendar_id" text DEFAULT 'primary' NOT NULL;--> statement-breakpoint
CREATE TABLE "calendar_sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"calendar_event_id" text,
	"operation" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_sync_jobs_operation_check" CHECK ("calendar_sync_jobs"."operation" in ('upsert', 'delete')),
	CONSTRAINT "calendar_sync_jobs_status_check" CHECK ("calendar_sync_jobs"."status" in ('pending', 'processing', 'succeeded', 'failed')),
	CONSTRAINT "calendar_sync_jobs_attempts_check" CHECK ("calendar_sync_jobs"."attempts" >= 0)
);
CREATE INDEX "calendar_sync_jobs_pending_idx" ON "calendar_sync_jobs" USING btree ("status","created_at") WHERE "calendar_sync_jobs"."status" in ('pending', 'failed');--> statement-breakpoint
CREATE INDEX "calendar_sync_jobs_task_id_idx" ON "calendar_sync_jobs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "calendar_sync_jobs_owner_user_id_idx" ON "calendar_sync_jobs" USING btree ("owner_user_id");--> statement-breakpoint
ALTER TABLE "calendar_sync_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calendar_sync_jobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "calendar_sync_jobs_select_own"
ON "calendar_sync_jobs"
FOR SELECT
TO authenticated
USING (owner_user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "calendar_sync_jobs_insert_own"
ON "calendar_sync_jobs"
FOR INSERT
TO authenticated
WITH CHECK (owner_user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "calendar_sync_jobs_update_own"
ON "calendar_sync_jobs"
FOR UPDATE
TO authenticated
USING (owner_user_id = auth.uid())
WITH CHECK (owner_user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "calendar_sync_jobs_delete_own"
ON "calendar_sync_jobs"
FOR DELETE
TO authenticated
USING (owner_user_id = auth.uid());

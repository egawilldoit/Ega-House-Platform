ALTER TABLE "tasks" ADD COLUMN "calendar_event_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "calendar_sync_status" varchar(32);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "calendar_sync_failure_reason" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_calendar_sync_status_check" CHECK ("tasks"."calendar_sync_status" is null or "tasks"."calendar_sync_status" in ('pending', 'synced', 'failed', 'skipped'));
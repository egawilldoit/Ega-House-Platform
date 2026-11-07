-- Notification events, targets, policy states, and owner quiet-hours settings (PWA-18 / #347)

-- Widen canonical notification event taxonomy.
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_type_check";--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('task_reminder', 'task_comment_mention', 'timer_state_change', 'routine_reminder', 'money_threshold', 'daily_review', 'weekly_review', 'job_search_reminder'));--> statement-breakpoint

-- Widen semantic target types (`review`/`today` are singletons with a null id).
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_target_type_check";--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_target_type_check" CHECK ("notifications"."target_type" is null or "notifications"."target_type" in ('task', 'timer', 'routine', 'money', 'review', 'today'));--> statement-breakpoint

-- Widen per-type channel preferences.
ALTER TABLE "notification_preferences" DROP CONSTRAINT IF EXISTS "notification_preferences_type_check";--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_type_check" CHECK ("notification_preferences"."notification_type" in ('task_reminder', 'task_comment_mention', 'timer_state_change', 'routine_reminder', 'money_threshold', 'daily_review', 'weekly_review', 'job_search_reminder'));--> statement-breakpoint

-- `suppressed` is a recorded terminal result (opt-out / quiet hours), not a queue.
ALTER TABLE "notification_deliveries" DROP CONSTRAINT IF EXISTS "notification_deliveries_status_check";--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_status_check" CHECK ("notification_deliveries"."status" in ('queued', 'sending', 'provider_accepted', 'retry_scheduled', 'invalid_endpoint', 'failed', 'suppressed'));--> statement-breakpoint

-- Owner-level quiet-hours settings. Timezone authority remains user_time_context.
CREATE TABLE IF NOT EXISTS "notification_settings" (
	"owner_user_id" uuid PRIMARY KEY DEFAULT auth.uid() NOT NULL,
	"quiet_hours_enabled" boolean DEFAULT false NOT NULL,
	"quiet_hours_start" varchar(5) DEFAULT '22:00' NOT NULL,
	"quiet_hours_end" varchar(5) DEFAULT '07:00' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_settings_quiet_hours_start_check" CHECK ("notification_settings"."quiet_hours_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "notification_settings_quiet_hours_end_check" CHECK ("notification_settings"."quiet_hours_end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);--> statement-breakpoint
ALTER TABLE "notification_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "notification_settings_select_own" ON "notification_settings";--> statement-breakpoint
DROP POLICY IF EXISTS "notification_settings_insert_own" ON "notification_settings";--> statement-breakpoint
DROP POLICY IF EXISTS "notification_settings_update_own" ON "notification_settings";--> statement-breakpoint
CREATE POLICY "notification_settings_select_own" ON "notification_settings" FOR SELECT TO authenticated USING (owner_user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "notification_settings_insert_own" ON "notification_settings" FOR INSERT TO authenticated WITH CHECK (owner_user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "notification_settings_update_own" ON "notification_settings" FOR UPDATE TO authenticated USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());--> statement-breakpoint
REVOKE ALL ON TABLE "notification_settings" FROM anon;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "notification_settings" TO authenticated;--> statement-breakpoint

CREATE TABLE "calendar_integration_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid DEFAULT auth.uid() NOT NULL,
	"provider" varchar(32) DEFAULT 'google' NOT NULL,
	"google_account_email" text,
	"scheduled_task_sync_enabled" boolean DEFAULT false NOT NULL,
	"default_reminder_minutes" integer DEFAULT 10 NOT NULL,
	"access_token_encrypted" text,
	"refresh_token_encrypted" text,
	"token_expires_at" timestamp with time zone,
	"connected_at" timestamp with time zone,
	"disconnected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_integration_settings_provider_check" CHECK ("calendar_integration_settings"."provider" in ('google')),
	CONSTRAINT "calendar_integration_settings_default_reminder_check" CHECK ("calendar_integration_settings"."default_reminder_minutes" >= 0 and "calendar_integration_settings"."default_reminder_minutes" <= 10080)
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "calendar_sync_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "calendar_reminder_minutes" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
CREATE INDEX "calendar_integration_settings_owner_user_id_idx" ON "calendar_integration_settings" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_integration_settings_owner_provider_unique" ON "calendar_integration_settings" USING btree ("owner_user_id","provider");
--> statement-breakpoint
ALTER TABLE "calendar_integration_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calendar_integration_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "calendar_integration_settings_select_own"
ON "calendar_integration_settings"
FOR SELECT
TO authenticated
USING (owner_user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "calendar_integration_settings_insert_own"
ON "calendar_integration_settings"
FOR INSERT
TO authenticated
WITH CHECK (owner_user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "calendar_integration_settings_update_own"
ON "calendar_integration_settings"
FOR UPDATE
TO authenticated
USING (owner_user_id = auth.uid())
WITH CHECK (owner_user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "calendar_integration_settings_delete_own"
ON "calendar_integration_settings"
FOR DELETE
TO authenticated
USING (owner_user_id = auth.uid());

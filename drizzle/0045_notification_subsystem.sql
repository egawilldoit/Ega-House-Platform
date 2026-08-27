-- Notification subsystem V1
-- Canonical notifications, devices, deliveries, preferences + evolve task_reminders

-- Evolve task_reminders: scheduling intent vs delivery
ALTER TABLE "task_reminders" ADD COLUMN "delivery_mode" varchar(32) DEFAULT 'email' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_reminders" ADD COLUMN "processed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task_reminders" ADD COLUMN "processing_error" text;--> statement-breakpoint
CREATE INDEX "task_reminders_pending_by_remind_at_idx" ON "task_reminders" USING btree ("status","remind_at") WHERE "task_reminders"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_delivery_mode_check" CHECK ("task_reminders"."delivery_mode" in ('push', 'email', 'both'));--> statement-breakpoint

-- Backfill legacy rows: channel already 'email', set delivery_mode consistently
UPDATE "task_reminders" SET "delivery_mode" = 'email' WHERE "delivery_mode" IS NULL;--> statement-breakpoint

-- notifications
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid DEFAULT auth.uid() NOT NULL,
	"type" varchar(32) NOT NULL,
	"title" varchar(512) NOT NULL,
	"body" text,
	"target_type" varchar(32),
	"target_id" uuid,
	"idempotency_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('task_reminder')),
	CONSTRAINT "notifications_target_type_check" CHECK ("notifications"."target_type" is null or "notifications"."target_type" in ('task'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_owner_idempotency_unique" ON "notifications" USING btree ("owner_user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "notifications_owner_created_idx" ON "notifications" USING btree ("owner_user_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "notifications_owner_unread_idx" ON "notifications" USING btree ("owner_user_id","created_at" DESC) WHERE "notifications"."read_at" is null;--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "notifications_select_own" ON "notifications" FOR SELECT TO authenticated USING (owner_user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "notifications_insert_own" ON "notifications" FOR INSERT TO authenticated WITH CHECK (owner_user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "notifications_update_own" ON "notifications" FOR UPDATE TO authenticated USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "notifications_delete_own" ON "notifications" FOR DELETE TO authenticated USING (owner_user_id = auth.uid());--> statement-breakpoint

-- notification_devices
CREATE TABLE "notification_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid DEFAULT auth.uid() NOT NULL,
	"installation_id" text NOT NULL,
	"platform" varchar(16) NOT NULL,
	"provider" varchar(16) NOT NULL,
	"provider_token" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_devices_platform_check" CHECK ("notification_devices"."platform" in ('android')),
	CONSTRAINT "notification_devices_provider_check" CHECK ("notification_devices"."provider" in ('fcm'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "notification_devices_installation_unique" ON "notification_devices" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "notification_devices_owner_idx" ON "notification_devices" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "notification_devices_provider_token_idx" ON "notification_devices" USING btree ("provider_token");--> statement-breakpoint
CREATE INDEX "notification_devices_owner_active_idx" ON "notification_devices" USING btree ("owner_user_id","is_active") WHERE "notification_devices"."is_active" = true;--> statement-breakpoint
ALTER TABLE "notification_devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_devices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "notification_devices_select_own" ON "notification_devices" FOR SELECT TO authenticated USING (owner_user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "notification_devices_insert_own" ON "notification_devices" FOR INSERT TO authenticated WITH CHECK (owner_user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "notification_devices_update_own" ON "notification_devices" FOR UPDATE TO authenticated USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "notification_devices_delete_own" ON "notification_devices" FOR DELETE TO authenticated USING (owner_user_id = auth.uid());--> statement-breakpoint

-- notification_deliveries
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"owner_user_id" uuid DEFAULT auth.uid() NOT NULL,
	"channel" varchar(16) NOT NULL,
	"device_id" uuid,
	"provider" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_reason" text,
	"provider_accepted_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_channel_check" CHECK ("notification_deliveries"."channel" in ('push', 'email')),
	CONSTRAINT "notification_deliveries_provider_check" CHECK ("notification_deliveries"."provider" in ('fcm', 'resend')),
	CONSTRAINT "notification_deliveries_status_check" CHECK ("notification_deliveries"."status" in ('queued', 'sending', 'provider_accepted', 'retry_scheduled', 'invalid_endpoint', 'failed')),
	CONSTRAINT "notification_deliveries_attempts_check" CHECK ("notification_deliveries"."attempt_count" >= 0),
	CONSTRAINT "notification_deliveries_notification_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "notification_deliveries_device_fk" FOREIGN KEY ("device_id") REFERENCES "public"."notification_devices"("id") ON DELETE set null ON UPDATE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_unique_per_target" ON "notification_deliveries" USING btree ("notification_id","channel","device_id");--> statement-breakpoint
-- Additional coalesce index to prevent duplicate email deliveries per notification (device_id null case)
CREATE UNIQUE INDEX "notification_deliveries_unique_coalesce" ON "notification_deliveries" USING btree ("notification_id","channel", COALESCE("device_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "notification_deliveries_status_retry_idx" ON "notification_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_notification_idx" ON "notification_deliveries" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_owner_idx" ON "notification_deliveries" USING btree ("owner_user_id");--> statement-breakpoint
ALTER TABLE "notification_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_deliveries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "notification_deliveries_select_own" ON "notification_deliveries" FOR SELECT TO authenticated USING (owner_user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "notification_deliveries_insert_own" ON "notification_deliveries" FOR INSERT TO authenticated WITH CHECK (owner_user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "notification_deliveries_update_own" ON "notification_deliveries" FOR UPDATE TO authenticated USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "notification_deliveries_delete_own" ON "notification_deliveries" FOR DELETE TO authenticated USING (owner_user_id = auth.uid());--> statement-breakpoint

-- notification_preferences
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid DEFAULT auth.uid() NOT NULL,
	"notification_type" varchar(32) NOT NULL,
	"push_enabled" boolean DEFAULT true NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_type_check" CHECK ("notification_preferences"."notification_type" in ('task_reminder'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_owner_type_unique" ON "notification_preferences" USING btree ("owner_user_id","notification_type");--> statement-breakpoint
CREATE INDEX "notification_preferences_owner_idx" ON "notification_preferences" USING btree ("owner_user_id");--> statement-breakpoint
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "notification_preferences_select_own" ON "notification_preferences" FOR SELECT TO authenticated USING (owner_user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "notification_preferences_insert_own" ON "notification_preferences" FOR INSERT TO authenticated WITH CHECK (owner_user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "notification_preferences_update_own" ON "notification_preferences" FOR UPDATE TO authenticated USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "notification_preferences_delete_own" ON "notification_preferences" FOR DELETE TO authenticated USING (owner_user_id = auth.uid());--> statement-breakpoint

-- Secure device ownership claim function
-- Atomically claims an installation for the authenticated user, never accepts owner_user_id param
CREATE OR REPLACE FUNCTION public.claim_notification_device(
  p_installation_id text,
  p_platform text,
  p_provider text,
  p_provider_token text
) RETURNS public.notification_devices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_device public.notification_devices%ROWTYPE;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_platform NOT IN ('android') THEN
    RAISE EXCEPTION 'Unsupported platform: %', p_platform;
  END IF;

  IF p_provider NOT IN ('fcm') THEN
    RAISE EXCEPTION 'Unsupported provider: %', p_provider;
  END IF;

  IF p_installation_id IS NULL OR length(trim(p_installation_id)) = 0 THEN
    RAISE EXCEPTION 'installation_id is required';
  END IF;

  IF p_provider_token IS NULL OR length(trim(p_provider_token)) = 0 THEN
    RAISE EXCEPTION 'provider_token is required';
  END IF;

  -- Deactivate any other active device with same provider_token owned by a different user
  -- This prevents token reuse across accounts.
  UPDATE public.notification_devices
  SET is_active = false,
      invalidated_at = now(),
      updated_at = now()
  WHERE provider_token = p_provider_token
    AND owner_user_id <> v_actor
    AND is_active = true;

  INSERT INTO public.notification_devices (
    owner_user_id, installation_id, platform, provider, provider_token, is_active, last_seen_at
  ) VALUES (
    v_actor, p_installation_id, p_platform, p_provider, p_provider_token, true, now()
  )
  ON CONFLICT (installation_id) DO UPDATE
    SET owner_user_id = EXCLUDED.owner_user_id,
        platform = EXCLUDED.platform,
        provider = EXCLUDED.provider,
        provider_token = EXCLUDED.provider_token,
        is_active = true,
        last_seen_at = now(),
        invalidated_at = NULL,
        updated_at = now()
  RETURNING * INTO v_device;

  RETURN v_device;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.claim_notification_device(text, text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.claim_notification_device(text, text, text, text) TO authenticated;--> statement-breakpoint

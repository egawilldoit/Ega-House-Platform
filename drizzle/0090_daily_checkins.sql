-- Canonical daily check-in (PO-05, issue #345).
--
-- One qualitative outcome record per owner/local date. Timer hours and task
-- completion stay in their canonical stores and are derived at read time;
-- this table never copies them. Upserts by (owner_user_id, local_date)
-- guarantee one record per day across retries and concurrent partial saves.
--
-- Rollout: additive table. Apply before deploying code that reads/writes
-- daily_checkins. On rollback, stop using the table; it may remain in place.
CREATE TABLE IF NOT EXISTS "public"."daily_checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid DEFAULT auth.uid() NOT NULL,
	"local_date" date NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"outcomes" varchar(500),
	"personal_minutes" integer,
	"notes" varchar(1000),
	"overtime_minutes" integer,
	"overtime_reason" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_checkins_personal_minutes_check"
		CHECK ("personal_minutes" IS NULL OR ("personal_minutes" >= 0 AND "personal_minutes" <= 1440)),
	CONSTRAINT "daily_checkins_overtime_minutes_check"
		CHECK ("overtime_minutes" IS NULL OR ("overtime_minutes" >= 0 AND "overtime_minutes" <= 1440)),
	CONSTRAINT "daily_checkins_overtime_reason_check"
		CHECK (
			"overtime_minutes" IS NULL
			OR "overtime_minutes" = 0
			OR ("overtime_reason" IS NOT NULL AND btrim("overtime_reason") <> '')
		),
	CONSTRAINT "daily_checkins_owner_date_unique"
		UNIQUE ("owner_user_id", "local_date")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "daily_checkins_owner_date_idx"
	ON "public"."daily_checkins" USING btree ("owner_user_id", "local_date" DESC);
--> statement-breakpoint
ALTER TABLE "public"."daily_checkins" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."daily_checkins" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "daily_checkins_direct_user_select" ON "public"."daily_checkins";
CREATE POLICY "daily_checkins_direct_user_select" ON "public"."daily_checkins"
  FOR SELECT TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "daily_checkins_direct_user_insert" ON "public"."daily_checkins";
CREATE POLICY "daily_checkins_direct_user_insert" ON "public"."daily_checkins"
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "daily_checkins_direct_user_update" ON "public"."daily_checkins";
CREATE POLICY "daily_checkins_direct_user_update" ON "public"."daily_checkins"
  FOR UPDATE TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  )
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "daily_checkins_direct_user_delete" ON "public"."daily_checkins";

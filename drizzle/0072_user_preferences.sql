-- Durable per-owner workspace preferences (EGA-798).
--
-- Appearance (theme, accent, density, reduced motion) and workspace defaults
-- (launch page, task layout, task open mode) live in one owner-scoped row.
-- CHECK constraints are the server-side enum authority at the persistence
-- boundary; the application layer validates the same values before writing.
-- A missing row is the documented default set, so existing owners keep the
-- behaviour they had before this table existed.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."user_preferences" (
	"user_id" uuid PRIMARY KEY DEFAULT auth.uid() NOT NULL,
	"theme" varchar(16) DEFAULT 'system' NOT NULL,
	"accent" varchar(16) DEFAULT 'neutral' NOT NULL,
	"density" varchar(16) DEFAULT 'comfortable' NOT NULL,
	"reduced_motion" boolean DEFAULT false NOT NULL,
	"launch_page" varchar(16) DEFAULT 'home' NOT NULL,
	"task_layout" varchar(16) DEFAULT 'list' NOT NULL,
	"task_open_mode" varchar(16) DEFAULT 'panel' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_theme_check" CHECK ("theme" in ('system', 'light', 'dark')),
	CONSTRAINT "user_preferences_accent_check" CHECK ("accent" in ('neutral', 'blue', 'green', 'violet', 'amber')),
	CONSTRAINT "user_preferences_density_check" CHECK ("density" in ('comfortable', 'compact')),
	CONSTRAINT "user_preferences_launch_page_check" CHECK ("launch_page" in ('home', 'today', 'tasks')),
	CONSTRAINT "user_preferences_task_layout_check" CHECK ("task_layout" in ('list', 'kanban')),
	CONSTRAINT "user_preferences_task_open_mode_check" CHECK ("task_open_mode" in ('panel', 'full'))
);
--> statement-breakpoint
ALTER TABLE "public"."user_preferences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."user_preferences" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "user_preferences_select_own" ON "public"."user_preferences";
CREATE POLICY "user_preferences_select_own"
ON "public"."user_preferences"
FOR SELECT
TO authenticated
USING (user_id = (SELECT auth.uid()));
--> statement-breakpoint
DROP POLICY IF EXISTS "user_preferences_insert_own" ON "public"."user_preferences";
CREATE POLICY "user_preferences_insert_own"
ON "public"."user_preferences"
FOR INSERT
TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()));
--> statement-breakpoint
DROP POLICY IF EXISTS "user_preferences_update_own" ON "public"."user_preferences";
CREATE POLICY "user_preferences_update_own"
ON "public"."user_preferences"
FOR UPDATE
TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));
--> statement-breakpoint
DROP POLICY IF EXISTS "user_preferences_delete_own" ON "public"."user_preferences";
CREATE POLICY "user_preferences_delete_own"
ON "public"."user_preferences"
FOR DELETE
TO authenticated
USING (user_id = (SELECT auth.uid()));

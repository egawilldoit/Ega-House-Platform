CREATE TABLE IF NOT EXISTS "task_saved_views" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_user_id" uuid DEFAULT auth.uid(),
  "name" varchar(80) NOT NULL,
  "status" varchar(64),
  "project_id" uuid,
  "goal_id" uuid,
  "due_filter" varchar(32) DEFAULT 'all' NOT NULL,
  "sort_value" varchar(32) DEFAULT 'updated_desc' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_saved_views"
  ADD CONSTRAINT "task_saved_views_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_saved_views"
  ADD CONSTRAINT "task_saved_views_goal_id_goals_id_fk"
  FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "task_saved_views_owner_user_id_idx" ON "task_saved_views" USING btree ("owner_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "task_saved_views_owner_user_id_name_unique" ON "task_saved_views" USING btree ("owner_user_id", "name");
--> statement-breakpoint
ALTER TABLE "task_saved_views" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "task_saved_views_owner_access" ON "task_saved_views";
--> statement-breakpoint
CREATE POLICY "task_saved_views_owner_access"
ON "task_saved_views"
FOR ALL
TO authenticated
USING (owner_user_id = auth.uid())
WITH CHECK (owner_user_id = auth.uid());

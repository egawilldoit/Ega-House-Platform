ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "goals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "task_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "week_reviews" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS "projects_authenticated_full_access" ON "projects";
--> statement-breakpoint
CREATE POLICY "projects_authenticated_full_access"
ON "projects"
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
--> statement-breakpoint

DROP POLICY IF EXISTS "goals_authenticated_full_access" ON "goals";
--> statement-breakpoint
CREATE POLICY "goals_authenticated_full_access"
ON "goals"
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
--> statement-breakpoint

DROP POLICY IF EXISTS "tasks_authenticated_full_access" ON "tasks";
--> statement-breakpoint
CREATE POLICY "tasks_authenticated_full_access"
ON "tasks"
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
--> statement-breakpoint

DROP POLICY IF EXISTS "task_sessions_authenticated_full_access" ON "task_sessions";
--> statement-breakpoint
CREATE POLICY "task_sessions_authenticated_full_access"
ON "task_sessions"
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
--> statement-breakpoint

DROP POLICY IF EXISTS "week_reviews_authenticated_full_access" ON "week_reviews";
--> statement-breakpoint
CREATE POLICY "week_reviews_authenticated_full_access"
ON "week_reviews"
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

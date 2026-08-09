DROP INDEX IF EXISTS "projects_slug_unique";--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "owner_user_id" uuid DEFAULT auth.uid();--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "owner_user_id" uuid DEFAULT auth.uid();--> statement-breakpoint
ALTER TABLE "task_sessions" ADD COLUMN "owner_user_id" uuid DEFAULT auth.uid();--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "owner_user_id" uuid DEFAULT auth.uid();--> statement-breakpoint
ALTER TABLE "week_reviews" ADD COLUMN "owner_user_id" uuid DEFAULT auth.uid();--> statement-breakpoint
CREATE INDEX "goals_owner_user_id_idx" ON "goals" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "projects_owner_user_id_idx" ON "projects" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_owner_user_id_slug_unique" ON "projects" USING btree ("owner_user_id","slug");--> statement-breakpoint
CREATE INDEX "task_sessions_owner_user_id_idx" ON "task_sessions" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "tasks_owner_user_id_idx" ON "tasks" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "week_reviews_owner_user_id_idx" ON "week_reviews" USING btree ("owner_user_id");--> statement-breakpoint

DROP POLICY IF EXISTS "projects_authenticated_full_access" ON "projects";--> statement-breakpoint
DROP POLICY IF EXISTS "goals_authenticated_full_access" ON "goals";--> statement-breakpoint
DROP POLICY IF EXISTS "tasks_authenticated_full_access" ON "tasks";--> statement-breakpoint
DROP POLICY IF EXISTS "task_sessions_authenticated_full_access" ON "task_sessions";--> statement-breakpoint
DROP POLICY IF EXISTS "week_reviews_authenticated_full_access" ON "week_reviews";--> statement-breakpoint

DROP POLICY IF EXISTS "projects_select_own" ON "projects";--> statement-breakpoint
DROP POLICY IF EXISTS "projects_insert_own" ON "projects";--> statement-breakpoint
DROP POLICY IF EXISTS "projects_update_own" ON "projects";--> statement-breakpoint
DROP POLICY IF EXISTS "projects_delete_own" ON "projects";--> statement-breakpoint
DROP POLICY IF EXISTS "goals_select_own" ON "goals";--> statement-breakpoint
DROP POLICY IF EXISTS "goals_insert_own" ON "goals";--> statement-breakpoint
DROP POLICY IF EXISTS "goals_update_own" ON "goals";--> statement-breakpoint
DROP POLICY IF EXISTS "goals_delete_own" ON "goals";--> statement-breakpoint
DROP POLICY IF EXISTS "tasks_select_own" ON "tasks";--> statement-breakpoint
DROP POLICY IF EXISTS "tasks_insert_own" ON "tasks";--> statement-breakpoint
DROP POLICY IF EXISTS "tasks_update_own" ON "tasks";--> statement-breakpoint
DROP POLICY IF EXISTS "tasks_delete_own" ON "tasks";--> statement-breakpoint
DROP POLICY IF EXISTS "task_sessions_select_own" ON "task_sessions";--> statement-breakpoint
DROP POLICY IF EXISTS "task_sessions_insert_own" ON "task_sessions";--> statement-breakpoint
DROP POLICY IF EXISTS "task_sessions_update_own" ON "task_sessions";--> statement-breakpoint
DROP POLICY IF EXISTS "task_sessions_delete_own" ON "task_sessions";--> statement-breakpoint
DROP POLICY IF EXISTS "week_reviews_select_own" ON "week_reviews";--> statement-breakpoint
DROP POLICY IF EXISTS "week_reviews_insert_own" ON "week_reviews";--> statement-breakpoint
DROP POLICY IF EXISTS "week_reviews_update_own" ON "week_reviews";--> statement-breakpoint
DROP POLICY IF EXISTS "week_reviews_delete_own" ON "week_reviews";--> statement-breakpoint

ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "goals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "week_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "projects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "goals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "week_reviews" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "projects_select_own"
ON "projects"
FOR SELECT
TO authenticated
USING (owner_user_id = auth.uid());--> statement-breakpoint

CREATE POLICY "projects_insert_own"
ON "projects"
FOR INSERT
TO authenticated
WITH CHECK (owner_user_id = auth.uid());--> statement-breakpoint

CREATE POLICY "projects_update_own"
ON "projects"
FOR UPDATE
TO authenticated
USING (owner_user_id = auth.uid())
WITH CHECK (owner_user_id = auth.uid());--> statement-breakpoint

CREATE POLICY "projects_delete_own"
ON "projects"
FOR DELETE
TO authenticated
USING (owner_user_id = auth.uid());--> statement-breakpoint

CREATE POLICY "goals_select_own"
ON "goals"
FOR SELECT
TO authenticated
USING (owner_user_id = auth.uid());--> statement-breakpoint

CREATE POLICY "goals_insert_own"
ON "goals"
FOR INSERT
TO authenticated
WITH CHECK (
  owner_user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM "projects"
    WHERE "projects"."id" = "goals"."project_id"
      AND "projects"."owner_user_id" = auth.uid()
  )
);--> statement-breakpoint

CREATE POLICY "goals_update_own"
ON "goals"
FOR UPDATE
TO authenticated
USING (owner_user_id = auth.uid())
WITH CHECK (
  owner_user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM "projects"
    WHERE "projects"."id" = "goals"."project_id"
      AND "projects"."owner_user_id" = auth.uid()
  )
);--> statement-breakpoint

CREATE POLICY "goals_delete_own"
ON "goals"
FOR DELETE
TO authenticated
USING (owner_user_id = auth.uid());--> statement-breakpoint

CREATE POLICY "tasks_select_own"
ON "tasks"
FOR SELECT
TO authenticated
USING (owner_user_id = auth.uid());--> statement-breakpoint

CREATE POLICY "tasks_insert_own"
ON "tasks"
FOR INSERT
TO authenticated
WITH CHECK (
  owner_user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM "projects"
    WHERE "projects"."id" = "tasks"."project_id"
      AND "projects"."owner_user_id" = auth.uid()
  )
  AND (
    "tasks"."goal_id" IS NULL
    OR EXISTS (
      SELECT 1
      FROM "goals"
      WHERE "goals"."id" = "tasks"."goal_id"
        AND "goals"."owner_user_id" = auth.uid()
    )
  )
);--> statement-breakpoint

CREATE POLICY "tasks_update_own"
ON "tasks"
FOR UPDATE
TO authenticated
USING (owner_user_id = auth.uid())
WITH CHECK (
  owner_user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM "projects"
    WHERE "projects"."id" = "tasks"."project_id"
      AND "projects"."owner_user_id" = auth.uid()
  )
  AND (
    "tasks"."goal_id" IS NULL
    OR EXISTS (
      SELECT 1
      FROM "goals"
      WHERE "goals"."id" = "tasks"."goal_id"
        AND "goals"."owner_user_id" = auth.uid()
    )
  )
);--> statement-breakpoint

CREATE POLICY "tasks_delete_own"
ON "tasks"
FOR DELETE
TO authenticated
USING (owner_user_id = auth.uid());--> statement-breakpoint

CREATE POLICY "task_sessions_select_own"
ON "task_sessions"
FOR SELECT
TO authenticated
USING (owner_user_id = auth.uid());--> statement-breakpoint

CREATE POLICY "task_sessions_insert_own"
ON "task_sessions"
FOR INSERT
TO authenticated
WITH CHECK (
  owner_user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM "tasks"
    WHERE "tasks"."id" = "task_sessions"."task_id"
      AND "tasks"."owner_user_id" = auth.uid()
  )
);--> statement-breakpoint

CREATE POLICY "task_sessions_update_own"
ON "task_sessions"
FOR UPDATE
TO authenticated
USING (owner_user_id = auth.uid())
WITH CHECK (
  owner_user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM "tasks"
    WHERE "tasks"."id" = "task_sessions"."task_id"
      AND "tasks"."owner_user_id" = auth.uid()
  )
);--> statement-breakpoint

CREATE POLICY "task_sessions_delete_own"
ON "task_sessions"
FOR DELETE
TO authenticated
USING (owner_user_id = auth.uid());--> statement-breakpoint

CREATE POLICY "week_reviews_select_own"
ON "week_reviews"
FOR SELECT
TO authenticated
USING (owner_user_id = auth.uid());--> statement-breakpoint

CREATE POLICY "week_reviews_insert_own"
ON "week_reviews"
FOR INSERT
TO authenticated
WITH CHECK (owner_user_id = auth.uid());--> statement-breakpoint

CREATE POLICY "week_reviews_update_own"
ON "week_reviews"
FOR UPDATE
TO authenticated
USING (owner_user_id = auth.uid())
WITH CHECK (owner_user_id = auth.uid());--> statement-breakpoint

CREATE POLICY "week_reviews_delete_own"
ON "week_reviews"
FOR DELETE
TO authenticated
USING (owner_user_id = auth.uid());

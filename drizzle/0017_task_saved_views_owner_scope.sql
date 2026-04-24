ALTER TABLE "task_saved_views" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS "task_saved_views_owner_access" ON "task_saved_views";
--> statement-breakpoint
DROP POLICY IF EXISTS "task_saved_views_select_own" ON "task_saved_views";
--> statement-breakpoint
DROP POLICY IF EXISTS "task_saved_views_insert_own" ON "task_saved_views";
--> statement-breakpoint
DROP POLICY IF EXISTS "task_saved_views_update_own" ON "task_saved_views";
--> statement-breakpoint
DROP POLICY IF EXISTS "task_saved_views_delete_own" ON "task_saved_views";
--> statement-breakpoint

CREATE POLICY "task_saved_views_select_own"
ON "task_saved_views"
FOR SELECT
TO authenticated
USING (owner_user_id = auth.uid());
--> statement-breakpoint

CREATE POLICY "task_saved_views_insert_own"
ON "task_saved_views"
FOR INSERT
TO authenticated
WITH CHECK (
  owner_user_id = auth.uid()
  AND (
    "task_saved_views"."project_id" IS NULL
    OR EXISTS (
      SELECT 1
      FROM "projects"
      WHERE "projects"."id" = "task_saved_views"."project_id"
        AND "projects"."owner_user_id" = auth.uid()
    )
  )
  AND (
    "task_saved_views"."goal_id" IS NULL
    OR EXISTS (
      SELECT 1
      FROM "goals"
      WHERE "goals"."id" = "task_saved_views"."goal_id"
        AND "goals"."owner_user_id" = auth.uid()
    )
  )
);
--> statement-breakpoint

CREATE POLICY "task_saved_views_update_own"
ON "task_saved_views"
FOR UPDATE
TO authenticated
USING (owner_user_id = auth.uid())
WITH CHECK (
  owner_user_id = auth.uid()
  AND (
    "task_saved_views"."project_id" IS NULL
    OR EXISTS (
      SELECT 1
      FROM "projects"
      WHERE "projects"."id" = "task_saved_views"."project_id"
        AND "projects"."owner_user_id" = auth.uid()
    )
  )
  AND (
    "task_saved_views"."goal_id" IS NULL
    OR EXISTS (
      SELECT 1
      FROM "goals"
      WHERE "goals"."id" = "task_saved_views"."goal_id"
        AND "goals"."owner_user_id" = auth.uid()
    )
  )
);
--> statement-breakpoint

CREATE POLICY "task_saved_views_delete_own"
ON "task_saved_views"
FOR DELETE
TO authenticated
USING (owner_user_id = auth.uid());

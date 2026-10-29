-- Ordered subtask checklist items (EGA-782).
--
-- Checklist rows are not a second task hierarchy: they carry no timers,
-- reminders, recurrence, focus rank or completion evidence, and completing all
-- items never completes the parent task. Owner equality with the referenced
-- task is enforced at the persistence boundary, not only by the UI.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."task_subtasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid DEFAULT auth.uid() NOT NULL,
	"task_id" uuid NOT NULL,
	"title" varchar(256) NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_subtasks_title_not_blank" CHECK (length(btrim("title")) > 0),
	CONSTRAINT "task_subtasks_position_check" CHECK ("position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "public"."task_subtasks"
  ADD CONSTRAINT "task_subtasks_task_id_tasks_id_fk"
  FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_subtasks_task_position_idx"
  ON "public"."task_subtasks" USING btree ("task_id","position");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_subtasks_owner_idx"
  ON "public"."task_subtasks" USING btree ("owner_user_id");
--> statement-breakpoint
ALTER TABLE "public"."task_subtasks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Every read/write must be owner-scoped AND tied to a task the same owner owns.
-- A forged other-owner task_id is rejected by the WITH CHECK clause itself.
DROP POLICY IF EXISTS "task_subtasks_owner_select" ON "public"."task_subtasks";
CREATE POLICY "task_subtasks_owner_select" ON "public"."task_subtasks"
  FOR SELECT TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_id AND t.owner_user_id = (SELECT auth.uid())
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "task_subtasks_owner_insert" ON "public"."task_subtasks";
CREATE POLICY "task_subtasks_owner_insert" ON "public"."task_subtasks"
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_id AND t.owner_user_id = (SELECT auth.uid())
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "task_subtasks_owner_update" ON "public"."task_subtasks";
CREATE POLICY "task_subtasks_owner_update" ON "public"."task_subtasks"
  FOR UPDATE TO authenticated
  USING (owner_user_id = (SELECT auth.uid()))
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_id AND t.owner_user_id = (SELECT auth.uid())
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "task_subtasks_owner_delete" ON "public"."task_subtasks";
CREATE POLICY "task_subtasks_owner_delete" ON "public"."task_subtasks"
  FOR DELETE TO authenticated
  USING (owner_user_id = (SELECT auth.uid()));
--> statement-breakpoint
-- Promote is one transaction: create the task in the subtask's task
-- project/goal and delete the checklist row. A retry with the same subtask id
-- cannot duplicate the task because the row is consumed; a missing row returns
-- false without creating anything.
CREATE OR REPLACE FUNCTION public.promote_task_subtask(
  p_subtask_id uuid,
  p_new_task_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  item record;
  parent record;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO item
  FROM public.task_subtasks
  WHERE id = p_subtask_id AND owner_user_id = uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT project_id, goal_id INTO parent
  FROM public.tasks
  WHERE id = item.task_id AND owner_user_id = uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.tasks (id, owner_user_id, project_id, goal_id, title, status, priority)
  VALUES (p_new_task_id, uid, parent.project_id, parent.goal_id, item.title, 'todo', 'medium');

  DELETE FROM public.task_subtasks WHERE id = item.id AND owner_user_id = uid;

  RETURN true;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.promote_task_subtask(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_task_subtask(uuid, uuid) TO authenticated;

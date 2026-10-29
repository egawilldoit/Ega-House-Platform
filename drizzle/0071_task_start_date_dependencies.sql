-- EGA-794: timeline planning start date + owner-scoped task dependencies.
--
-- Semantics:
--   * tasks.start_date is a nullable date-only planning value. When both
--     start_date and due_date exist, due_date >= start_date is enforced
--     (inclusive window; same-day tasks are valid one-day bars).
--   * task_dependencies stores informational "blocked by" edges. Edges never
--     change status, move dates, schedule successors or start agents.
--
-- Ownership:
--   * owner_user_id defaults to auth.uid(); RLS confines every row to its owner.
--   * INSERT additionally requires both endpoint tasks to be owned by the same
--     owner, so a forged cross-owner task id fails at persistence even if a
--     caller bypasses the service precheck.
--
-- Cycle prevention:
--   * A client/domain precheck cannot stop two concurrent reverse inserts
--     (A blocked by B / B blocked by A). The trigger serializes writes per
--     owner with a transaction-scoped advisory lock, then walks the existing
--     predecessor chain; the second writer sees the first committed edge and
--     is rejected. The unique index still makes duplicate edges idempotent.

ALTER TABLE "public"."tasks" ADD COLUMN IF NOT EXISTS "start_date" date;
--> statement-breakpoint
ALTER TABLE "public"."tasks" DROP CONSTRAINT IF EXISTS "tasks_date_window_check";
--> statement-breakpoint
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_date_window_check"
  CHECK ("start_date" is null or "due_date" is null or "due_date" >= "start_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_owner_user_id_start_date_idx"
  ON "public"."tasks" USING btree ("owner_user_id", "start_date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."task_dependencies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_user_id" uuid DEFAULT auth.uid() NOT NULL,
  "task_id" uuid NOT NULL REFERENCES "public"."tasks"("id") ON DELETE CASCADE,
  "blocked_by_task_id" uuid NOT NULL REFERENCES "public"."tasks"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "task_dependencies_no_self_check" CHECK ("task_id" <> "blocked_by_task_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_dependencies_owner_edge_unique"
  ON "public"."task_dependencies" USING btree ("owner_user_id", "task_id", "blocked_by_task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_dependencies_owner_task_idx"
  ON "public"."task_dependencies" USING btree ("owner_user_id", "task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_dependencies_owner_blocked_by_idx"
  ON "public"."task_dependencies" USING btree ("owner_user_id", "blocked_by_task_id");
--> statement-breakpoint
ALTER TABLE "public"."task_dependencies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."task_dependencies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "task_dependencies_select_own" ON "public"."task_dependencies";
--> statement-breakpoint
DROP POLICY IF EXISTS "task_dependencies_insert_own" ON "public"."task_dependencies";
--> statement-breakpoint
DROP POLICY IF EXISTS "task_dependencies_delete_own" ON "public"."task_dependencies";
--> statement-breakpoint
CREATE POLICY "task_dependencies_select_own"
  ON "public"."task_dependencies"
  FOR SELECT
  TO authenticated
  USING (owner_user_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY "task_dependencies_insert_own"
  ON "public"."task_dependencies"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM "public"."tasks" AS dependent
      WHERE dependent.id = task_id AND dependent.owner_user_id = (SELECT auth.uid())
    )
    AND EXISTS (
      SELECT 1 FROM "public"."tasks" AS predecessor
      WHERE predecessor.id = blocked_by_task_id AND predecessor.owner_user_id = (SELECT auth.uid())
    )
  );
--> statement-breakpoint
CREATE POLICY "task_dependencies_delete_own"
  ON "public"."task_dependencies"
  FOR DELETE
  TO authenticated
  USING (owner_user_id = (SELECT auth.uid()));
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE "public"."task_dependencies" TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_task_dependency_invariants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  dependent_owner uuid;
  predecessor_owner uuid;
  creates_cycle boolean;
BEGIN
  IF NEW.task_id = NEW.blocked_by_task_id THEN
    RAISE EXCEPTION 'A task cannot be blocked by itself.' USING ERRCODE = '23514';
  END IF;

  SELECT task_record.owner_user_id INTO dependent_owner
  FROM public.tasks AS task_record
  WHERE task_record.id = NEW.task_id;

  SELECT task_record.owner_user_id INTO predecessor_owner
  FROM public.tasks AS task_record
  WHERE task_record.id = NEW.blocked_by_task_id;

  IF dependent_owner IS NULL OR predecessor_owner IS NULL THEN
    RAISE EXCEPTION 'Task dependency endpoints must exist.' USING ERRCODE = '23503';
  END IF;

  IF NEW.owner_user_id IS DISTINCT FROM dependent_owner
    OR NEW.owner_user_id IS DISTINCT FROM predecessor_owner THEN
    RAISE EXCEPTION 'Task dependency endpoints must belong to the edge owner.' USING ERRCODE = '42501';
  END IF;

  -- Serialize dependency writes per owner. A concurrent reverse insert waits
  -- here, then reads the committed edge below and fails the cycle check.
  PERFORM pg_advisory_xact_lock(hashtext('task-dependencies|' || NEW.owner_user_id::text));

  WITH RECURSIVE reachable(task_id) AS (
    SELECT NEW.blocked_by_task_id
    UNION
    SELECT dependency.blocked_by_task_id
    FROM public.task_dependencies AS dependency
    JOIN reachable ON dependency.task_id = reachable.task_id
    WHERE dependency.owner_user_id = NEW.owner_user_id
  )
  SELECT EXISTS (SELECT 1 FROM reachable WHERE task_id = NEW.task_id) INTO creates_cycle;

  IF creates_cycle THEN
    RAISE EXCEPTION 'Task dependency would create a cycle.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "enforce_task_dependency_invariants" ON "public"."task_dependencies";
--> statement-breakpoint
CREATE TRIGGER "enforce_task_dependency_invariants"
BEFORE INSERT OR UPDATE ON "public"."task_dependencies"
FOR EACH ROW EXECUTE FUNCTION public.enforce_task_dependency_invariants();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_task_dependency_invariants() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_task_dependency_invariants() FROM anon;

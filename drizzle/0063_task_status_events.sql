-- Durable Task status-transition ledger + canonical completed_at invariant.
--
-- Owner: every Task status mutation, regardless of surface (legacy web direct
-- writes, shared application/data-access writes, Hono/mobile writes, MCP
-- writes). Two database triggers are the single canonical boundary that cannot
-- be bypassed accidentally: a BEFORE trigger keeps tasks.completed_at (current
-- state) consistent with the status, and an AFTER trigger writes the
-- task_status_events ledger once the tasks row exists.
--
-- Invariant enforced here:
--   * INSERT with a done status  -> completed_at = caller instant or now(),
--     and one completion event
--   * transition INTO 'done'     -> completed_at = caller instant or now(),
--     and one completion event
--   * repeated write of 'done'   -> no new event, completed_at unchanged
--     while already done (including done-spelling renames)
--   * transition OUT of 'done'   -> completed_at = NULL, event recorded
--   * any non-done status        -> completed_at = NULL
--   * unrelated edits while done -> completed_at preserved
--
-- task_status_events is append-only from the product perspective: no
-- INSERT/UPDATE/DELETE policies are granted to client roles. Rows are only
-- written by the SECURITY DEFINER trigger function below and by the backfill
-- in this same migration. task_id uses ON DELETE SET NULL so events survive
-- a hard-deleted Task (e.g. project purge).
--
-- Backfill policy: one completion event ONLY for existing Tasks with a
-- trustworthy non-null completed_at. Completion timestamps are never invented
-- from updated_at. Tasks whose past completion evidence was already lost
-- (reopened before this migration through a path that cleared completed_at)
-- cannot be reconstructed honestly and stay without historical events.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."task_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid DEFAULT auth.uid() NOT NULL,
	"task_id" uuid REFERENCES "public"."tasks"("id") ON DELETE set null,
	"from_status" varchar(64),
	"to_status" varchar(64) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"operation_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_status_events_owner_user_id_occurred_at_idx" ON "public"."task_status_events" USING btree ("owner_user_id","occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_status_events_owner_user_id_task_id_occurred_at_idx" ON "public"."task_status_events" USING btree ("owner_user_id","task_id","occurred_at");
--> statement-breakpoint
ALTER TABLE "public"."task_status_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "task_status_events_direct_user_select" ON "public"."task_status_events";
CREATE POLICY "task_status_events_direct_user_select" ON "public"."task_status_events" FOR SELECT TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.task_status_is_done(status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(btrim(status)) IN ('done', 'complete', 'completed')
$$;
--> statement-breakpoint
-- Normalizes tasks.completed_at to follow the row's status. Runs BEFORE the
-- write because completed_at is a property of the tasks row. Invariant:
-- completed_at is non-null if and only if the status is a done spelling.
CREATE OR REPLACE FUNCTION public.normalize_task_completed_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF public.task_status_is_done(NEW.status) THEN
    IF TG_OP = 'UPDATE' AND public.task_status_is_done(OLD.status) THEN
      -- Still done (including a done-spelling rename): the trigger owns the
      -- instant, so an unrelated edit must neither move nor invent it.
      NEW.completed_at := OLD.completed_at;
    ELSE
      -- Entering done: stamp the caller-supplied instant, else the mutation
      -- instant.
      NEW.completed_at := COALESCE(NEW.completed_at, now());
    END IF;
  ELSE
    -- Any non-done status owns no completion time.
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Records the durable, append-only status-transition ledger. Runs AFTER the
-- write: a BEFORE trigger cannot reference NEW.id here yet because the tasks
-- row (the event's foreign-key parent) has not been inserted. The ledger stores
-- the normalized 'done' spelling so it matches the heatmap's completion filter.
CREATE OR REPLACE FUNCTION public.record_task_status_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF public.task_status_is_done(NEW.status) THEN
      INSERT INTO public.task_status_events (owner_user_id, task_id, from_status, to_status, occurred_at)
      VALUES (NEW.owner_user_id, NEW.id, NULL, 'done', COALESCE(NEW.completed_at, now()));
    END IF;
    RETURN NULL;
  END IF;

  -- Unchanged raw status: no transition to record.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;

  -- A change between two done spellings is not a new completion; recording it
  -- would double-count the day in the heatmap.
  IF public.task_status_is_done(NEW.status) AND public.task_status_is_done(OLD.status) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.task_status_events (owner_user_id, task_id, from_status, to_status, occurred_at)
  VALUES (
    NEW.owner_user_id,
    NEW.id,
    OLD.status,
    CASE WHEN public.task_status_is_done(NEW.status) THEN 'done' ELSE NEW.status END,
    CASE WHEN public.task_status_is_done(NEW.status) THEN COALESCE(NEW.completed_at, now()) ELSE now() END
  );
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS normalize_task_completed_at ON public.tasks;
CREATE TRIGGER normalize_task_completed_at
BEFORE INSERT OR UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.normalize_task_completed_at();
--> statement-breakpoint
DROP TRIGGER IF EXISTS record_task_status_event ON public.tasks;
CREATE TRIGGER record_task_status_event
AFTER INSERT OR UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.record_task_status_event();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.task_status_is_done(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_status_is_done(text) FROM anon;
REVOKE ALL ON FUNCTION public.normalize_task_completed_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.normalize_task_completed_at() FROM anon;
REVOKE ALL ON FUNCTION public.record_task_status_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_task_status_event() FROM anon;
--> statement-breakpoint
-- Backfill: one completion event per Task with a trustworthy completed_at.
-- Idempotent via the NOT EXISTS guard. Never derives timestamps from
-- updated_at; Tasks without a trustworthy completed_at get no event.
INSERT INTO public.task_status_events (owner_user_id, task_id, from_status, to_status, occurred_at)
SELECT task_record.owner_user_id, task_record.id, NULL, 'done', task_record.completed_at
FROM public.tasks AS task_record
WHERE task_record.completed_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.task_status_events AS existing_event
    WHERE existing_event.task_id = task_record.id
      AND existing_event.to_status = 'done'
  );
--> statement-breakpoint
-- Normalize current state: completed_at follows current status. The
-- trustworthy completion instant is already preserved as a durable event
-- above, so clearing it here does not erase historical evidence.
UPDATE public.tasks AS task_record
SET completed_at = NULL
WHERE task_record.completed_at IS NOT NULL
  AND NOT public.task_status_is_done(task_record.status);

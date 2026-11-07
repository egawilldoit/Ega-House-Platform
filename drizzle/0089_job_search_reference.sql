-- Durable, independently patchable job-search reference (PO-04).
--
-- This is intentionally a top-level user_preferences column, not a 4th key in
-- personal_operations. The schedule keeps its existing exactly-3-key shape and
-- CHECK, so a schedule save can never erase a concurrently set reference.
--
-- Task-only by design: `task_sessions` has no immutable project snapshot
-- (Track B owns session mutations), so project references and per-session
-- snapshots are deliberately deferred. Changing the reference intentionally
-- reclassifies historical totals.
--
-- Rollout: apply this migration before deploying code that reads/writes
-- `job_search_reference`. The column is additive and may remain in place on
-- rollback; stop reading/writing it (or drop it after backup). No 4-key
-- personal_operations rows remain after the backfill, so unrelated schedule
-- updates cannot hit a stale CHECK.
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS job_search_reference jsonb;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.valid_job_search_reference(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF value IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(value) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(value)) <> 2
     OR jsonb_typeof(value->'kind') IS DISTINCT FROM 'string'
     OR jsonb_typeof(value->'id') IS DISTINCT FROM 'string'
     OR (value->>'kind') IS DISTINCT FROM 'task'
     OR (value->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN others THEN RETURN false;
END $$;
--> statement-breakpoint
-- Backfill only the task-shaped references written by the unmerged 4-key
-- branch into the new column. Project/invalid legacy values are dropped below
-- because the new field is task-only.
UPDATE public.user_preferences
SET job_search_reference = personal_operations->'jobSearchReference',
    personal_operations = personal_operations - 'jobSearchReference'
WHERE personal_operations ? 'jobSearchReference'
  AND jsonb_typeof(personal_operations->'jobSearchReference') = 'object'
  AND (personal_operations->'jobSearchReference'->>'kind') = 'task'
  AND (personal_operations->'jobSearchReference'->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
--> statement-breakpoint
-- Strip any remaining reference key (null, project, or invalid shape) so the
-- 0078 3-key personal_operations CHECK stays valid.
UPDATE public.user_preferences
SET personal_operations = personal_operations - 'jobSearchReference'
WHERE personal_operations ? 'jobSearchReference';
--> statement-breakpoint
ALTER TABLE public.user_preferences
  ADD CONSTRAINT user_preferences_job_search_reference_check
  CHECK (public.valid_job_search_reference(job_search_reference));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.patch_user_preferences(patch jsonb)
RETURNS public.user_preferences
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE result public.user_preferences;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF jsonb_typeof(patch) IS DISTINCT FROM 'object' OR octet_length(patch::text) > 20000
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(patch) AS key
                WHERE key NOT IN ('theme', 'accent', 'density', 'reducedMotion', 'launchPage', 'taskLayout', 'taskOpenMode', 'personalOperations', 'jobSearchReference')) THEN
    RAISE EXCEPTION 'invalid preference patch';
  END IF;
  INSERT INTO public.user_preferences (user_id) VALUES (auth.uid()) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.user_preferences SET
    theme = CASE WHEN patch ? 'theme' THEN patch->>'theme' ELSE theme END,
    accent = CASE WHEN patch ? 'accent' THEN patch->>'accent' ELSE accent END,
    density = CASE WHEN patch ? 'density' THEN patch->>'density' ELSE density END,
    reduced_motion = CASE WHEN patch ? 'reducedMotion' THEN (patch->>'reducedMotion')::boolean ELSE reduced_motion END,
    launch_page = CASE WHEN patch ? 'launchPage' THEN patch->>'launchPage' ELSE launch_page END,
    task_layout = CASE WHEN patch ? 'taskLayout' THEN patch->>'taskLayout' ELSE task_layout END,
    task_open_mode = CASE WHEN patch ? 'taskOpenMode' THEN patch->>'taskOpenMode' ELSE task_open_mode END,
    personal_operations = CASE WHEN patch ? 'personalOperations' THEN patch->'personalOperations' ELSE personal_operations END,
    job_search_reference = CASE WHEN patch ? 'jobSearchReference' THEN patch->'jobSearchReference' ELSE job_search_reference END,
    updated_at = now()
  WHERE user_id = auth.uid() RETURNING * INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'preference update refused'; END IF;
  RETURN result;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.patch_user_preferences(jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.patch_user_preferences(jsonb) TO authenticated;

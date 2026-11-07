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
-- Merge order dependency: Track D `0079_notification_events_policy` (when
-- 1787880000029) and Track C `0088_personal_expenses` (when 1787880000051)
-- must land on main before this migration. Drizzle skips a lower-`when`
-- migration that is merged after a higher one. If either is not on main when
-- this is merged, rebase and renumber this migration with a `when` greater
-- than the current main max.
--
-- Rollout: apply this migration before deploying code that reads/writes
-- `job_search_reference`. The column is additive and should remain in place on
-- rollback. Stop reading/writing the field; if the column must be dropped,
-- first restore the pre-0089 `patch_user_preferences` (the 0078 definition
-- without `job_search_reference`) and only then drop the column. A bare drop
-- would break every preference patch because the current RPC references it.
-- No 4-key personal_operations rows remain after the backfill, so unrelated
-- schedule updates cannot hit a stale CHECK.
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS job_search_reference jsonb;
--> statement-breakpoint
-- Restore the exact 0078 exactly-3-key validator. This is idempotent on a
-- normal 0078 database and converges a database that ever applied the deleted
-- branch 0079 (which accepted a 4th jobSearchReference key).
CREATE OR REPLACE FUNCTION public.valid_personal_operations(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE day text; target jsonb; block jsonb; other jsonb; item text;
BEGIN
  IF value IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(value) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(value)) <> 3
     OR jsonb_typeof(value->'paused') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(value->'targets') IS DISTINCT FROM 'object'
     OR jsonb_typeof(value->'guidance') IS DISTINCT FROM 'array'
     OR jsonb_array_length(value->'guidance') > 20
     OR (SELECT count(*) FROM jsonb_object_keys(value->'targets')) <> 7 THEN RETURN false; END IF;
  FOREACH day IN ARRAY ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] LOOP
    target := value->'targets'->day;
    IF jsonb_typeof(target) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(target)) <> 2
       OR jsonb_typeof(target->'work') IS DISTINCT FROM 'number' OR jsonb_typeof(target->'jobSearch') IS DISTINCT FROM 'number'
       OR (target->>'work') !~ '^(0|[1-9][0-9]*)$' OR (target->>'jobSearch') !~ '^(0|[1-9][0-9]*)$'
       OR (target->>'work')::numeric > 1440 OR (target->>'jobSearch')::numeric > 1440 THEN RETURN false; END IF;
  END LOOP;
  FOR block IN SELECT * FROM jsonb_array_elements(value->'guidance') LOOP
    IF jsonb_typeof(block) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(block)) <> 5
       OR jsonb_typeof(block->'name') IS DISTINCT FROM 'string' OR length(btrim(block->>'name')) = 0 OR length(block->>'name') > 80
       OR jsonb_typeof(block->'enabled') IS DISTINCT FROM 'boolean' OR jsonb_typeof(block->'days') IS DISTINCT FROM 'array'
       OR jsonb_typeof(block->'start') IS DISTINCT FROM 'string' OR jsonb_typeof(block->'end') IS DISTINCT FROM 'string'
       OR (block->>'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR (block->>'end') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       OR block->>'start' >= block->>'end' THEN RETURN false; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(block->'days') d WHERE jsonb_typeof(d) <> 'string') THEN RETURN false; END IF;
    FOR item IN SELECT jsonb_array_elements_text(block->'days') LOOP
      IF item NOT IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday') THEN RETURN false; END IF;
    END LOOP;
    IF jsonb_array_length(block->'days') <> (SELECT count(DISTINCT d) FROM jsonb_array_elements(block->'days') AS d) THEN RETURN false; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(value->'guidance') WITH ORDINALITY a(b, i)
    JOIN jsonb_array_elements(value->'guidance') WITH ORDINALITY c(b, i) ON a.i < c.i
    WHERE (a.b->>'enabled')::boolean AND (c.b->>'enabled')::boolean
      AND a.b->>'start' < c.b->>'end' AND c.b->>'start' < a.b->>'end'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.b->'days') d WHERE c.b->'days' @> jsonb_build_array(d))) THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN others THEN RETURN false;
END $$;
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
SET job_search_reference = jsonb_build_object(
      'kind', 'task',
      'id', personal_operations->'jobSearchReference'->>'id'
    ),
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
  DROP CONSTRAINT IF EXISTS user_preferences_job_search_reference_check;
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
    job_search_reference = CASE WHEN patch ? 'jobSearchReference' THEN NULLIF(patch->'jobSearchReference', 'null'::jsonb) ELSE job_search_reference END,
    updated_at = now()
  WHERE user_id = auth.uid() RETURNING * INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'preference update refused'; END IF;
  RETURN result;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.patch_user_preferences(jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.patch_user_preferences(jsonb) TO authenticated;

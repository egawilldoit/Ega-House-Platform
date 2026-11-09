-- Optional per-category monthly spending caps (PO-08, issue #349).
--
-- Caps live in validated owner preferences as a top-level `category_caps`
-- column, never a budget/category/account table. Values are monthly MAD
-- centimes per fixed expense category; absent keys mean no cap, an explicit
-- 0 means a zero cap. Caps are advisory progress targets and never block
-- expense creation.
--
-- Rollout: apply this migration before deploying code that reads/writes
-- `category_caps`. The column is additive and should remain in place on
-- rollback. Reads on pre-0091 deployments retry without the column and
-- normalize to no caps; writes fail closed until the migration is applied.
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS category_caps jsonb;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.valid_category_caps(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  item text;
  cap jsonb;
BEGIN
  IF value IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(value) <> 'object' THEN RETURN false; END IF;
  FOR item IN SELECT jsonb_object_keys(value) LOOP
    IF item NOT IN ('coffee', 'groceries', 'eating_out', 'transport', 'bills', 'subscriptions', 'household', 'health', 'other') THEN
      RETURN false;
    END IF;
    cap := value->item;
    IF jsonb_typeof(cap) IS DISTINCT FROM 'number'
       OR (cap #>> '{}') !~ '^(0|[1-9][0-9]*)$'
       OR (cap #>> '{}')::numeric > 2147483647 THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN others THEN RETURN false;
END $$;
--> statement-breakpoint
ALTER TABLE public.user_preferences
  DROP CONSTRAINT IF EXISTS user_preferences_category_caps_check;
--> statement-breakpoint
ALTER TABLE public.user_preferences
  ADD CONSTRAINT user_preferences_category_caps_check
  CHECK (public.valid_category_caps(category_caps));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.patch_user_preferences(patch jsonb)
RETURNS public.user_preferences
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE result public.user_preferences;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF jsonb_typeof(patch) IS DISTINCT FROM 'object' OR octet_length(patch::text) > 20000
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(patch) AS key
                WHERE key NOT IN ('theme', 'accent', 'density', 'reducedMotion', 'launchPage', 'taskLayout', 'taskOpenMode', 'personalOperations', 'jobSearchReference', 'categoryCaps')) THEN
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
    category_caps = CASE WHEN patch ? 'categoryCaps' THEN NULLIF(patch->'categoryCaps', 'null'::jsonb) ELSE category_caps END,
    updated_at = now()
  WHERE user_id = auth.uid() RETURNING * INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'preference update refused'; END IF;
  RETURN result;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.patch_user_preferences(jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.patch_user_preferences(jsonb) TO authenticated;

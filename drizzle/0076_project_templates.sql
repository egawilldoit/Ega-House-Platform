-- Project templates: atomic, idempotent project + goals + tasks creation.
--
-- A template is a typed application constant (packages/application/src/
-- projects/templates.ts). Persistence stays in the canonical projects, goals
-- and tasks tables: this migration adds only the retry receipt column and one
-- bounded SECURITY DEFINER function that writes all three tables inside ONE
-- PostgreSQL transaction. PostgREST cannot span a transaction across separate
-- Supabase calls, so a mid-way failure would otherwise leave a project without
-- its goals/tasks (or vice versa).
--
-- Guarantees enforced here, not by the caller:
--   * identity comes from auth.uid(); no owner id is accepted as an argument;
--   * direct user sessions only (an OAuth client_id token is refused);
--   * the same operation id returns the project created by the first attempt,
--     including the concurrent double-submit case (unique index + handler);
--   * goals and tasks are owner-scoped to the actor and parented to the
--     project created by this call, so parent-owner equality cannot be forged;
--   * goals/tasks payloads are shape- and size-bounded before any insert;
--   * any raised error rolls the whole transaction back: no partial entities.
--> statement-breakpoint
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS template_operation_id uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS projects_template_operation_unique
  ON public.projects (owner_user_id, template_operation_id)
  WHERE template_operation_id IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.create_project_from_template(
  p_operation_id uuid,
  p_template_id text,
  p_name text,
  p_slug text,
  p_description text,
  p_goals jsonb,
  p_tasks jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid;
  v_project_id uuid;
  v_existing_id uuid;
  v_existing_slug text;
  v_goal_id uuid;
  v_goal_ids uuid[] := '{}';
  v_goal_count integer := 0;
  v_task_count integer := 0;
  v_goal_input_count integer;
  v_task_input_count integer;
  i integer;
BEGIN
  v_actor := (SELECT auth.uid());
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL THEN
    RAISE EXCEPTION 'Direct user session required.' USING ERRCODE = '42501';
  END IF;

  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'Template operation id is required.' USING ERRCODE = '22023';
  END IF;
  IF p_template_id IS NULL
    OR p_template_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    OR length(p_template_id) > 64 THEN
    RAISE EXCEPTION 'Template id is invalid.' USING ERRCODE = '22023';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' OR length(btrim(p_name)) > 256 THEN
    RAISE EXCEPTION 'Project name is invalid.' USING ERRCODE = '22023';
  END IF;
  IF p_slug IS NULL
    OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    OR length(p_slug) > 256 THEN
    RAISE EXCEPTION 'Project slug is invalid.' USING ERRCODE = '22023';
  END IF;
  IF p_description IS NOT NULL AND length(p_description) > 4000 THEN
    RAISE EXCEPTION 'Project description is too long.' USING ERRCODE = '22023';
  END IF;
  IF p_goals IS NULL OR jsonb_typeof(p_goals) <> 'array' THEN
    RAISE EXCEPTION 'Template goals payload is invalid.' USING ERRCODE = '22023';
  END IF;
  IF p_tasks IS NULL OR jsonb_typeof(p_tasks) <> 'array' THEN
    RAISE EXCEPTION 'Template tasks payload is invalid.' USING ERRCODE = '22023';
  END IF;

  v_goal_input_count := jsonb_array_length(p_goals);
  v_task_input_count := jsonb_array_length(p_tasks);

  IF v_goal_input_count > 25 OR v_task_input_count > 200 THEN
    RAISE EXCEPTION 'Template payload is too large.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_goals) AS goal_item(value)
    WHERE jsonb_typeof(goal_item.value) <> 'object'
      OR goal_item.value->'title' IS NULL
      OR jsonb_typeof(goal_item.value->'title') <> 'string'
      OR btrim(goal_item.value->>'title') = ''
      OR length(goal_item.value->>'title') > 256
      OR (
        goal_item.value ? 'description'
        AND jsonb_typeof(goal_item.value->'description') NOT IN ('string', 'null')
      )
      OR length(COALESCE(goal_item.value->>'description', '')) > 4000
      OR COALESCE(goal_item.value->>'status', '') NOT IN ('draft', 'active', 'done', 'paused')
  ) THEN
    RAISE EXCEPTION 'Template goals payload is invalid.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_tasks) AS task_item(value)
    WHERE jsonb_typeof(task_item.value) <> 'object'
      OR task_item.value->'title' IS NULL
      OR jsonb_typeof(task_item.value->'title') <> 'string'
      OR btrim(task_item.value->>'title') = ''
      OR length(task_item.value->>'title') > 256
      OR (
        task_item.value ? 'description'
        AND jsonb_typeof(task_item.value->'description') NOT IN ('string', 'null')
      )
      OR length(COALESCE(task_item.value->>'description', '')) > 4000
      OR COALESCE(task_item.value->>'priority', '') NOT IN ('low', 'medium', 'high', 'urgent')
      OR (
        task_item.value ? 'estimate_minutes'
        AND jsonb_typeof(task_item.value->'estimate_minutes') NOT IN ('number', 'null')
      )
      OR (
        task_item.value ? 'estimate_minutes'
        AND jsonb_typeof(task_item.value->'estimate_minutes') = 'number'
        AND (
          trunc((task_item.value->>'estimate_minutes')::numeric)
            <> (task_item.value->>'estimate_minutes')::numeric
          OR (task_item.value->>'estimate_minutes')::numeric < 1
          OR (task_item.value->>'estimate_minutes')::numeric > 1440
        )
      )
      OR (
        task_item.value ? 'due_date'
        AND jsonb_typeof(task_item.value->'due_date') NOT IN ('string', 'null')
      )
      OR (
        task_item.value ? 'due_date'
        AND jsonb_typeof(task_item.value->'due_date') = 'string'
        AND (task_item.value->>'due_date') !~ '^\d{4}-\d{2}-\d{2}$'
      )
      OR (
        task_item.value ? 'goal_index'
        AND jsonb_typeof(task_item.value->'goal_index') NOT IN ('number', 'null')
      )
      OR (
        task_item.value ? 'goal_index'
        AND jsonb_typeof(task_item.value->'goal_index') = 'number'
        AND (
          trunc((task_item.value->>'goal_index')::numeric)
            <> (task_item.value->>'goal_index')::numeric
          OR (task_item.value->>'goal_index')::numeric < 0
          OR (task_item.value->>'goal_index')::numeric >= v_goal_input_count
        )
      )
  ) THEN
    RAISE EXCEPTION 'Template tasks payload is invalid.' USING ERRCODE = '22023';
  END IF;

  -- Retry/double-submit: the operation receipt is the projects row itself.
  SELECT project_record.id, project_record.slug
    INTO v_existing_id, v_existing_slug
  FROM public.projects AS project_record
  WHERE project_record.owner_user_id = v_actor
    AND project_record.template_operation_id = p_operation_id;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'replayed',
      'project_id', v_existing_id,
      'slug', v_existing_slug,
      'goal_count', (
        SELECT count(*)::int FROM public.goals AS goal_record
        WHERE goal_record.project_id = v_existing_id
          AND goal_record.owner_user_id = v_actor
      ),
      'task_count', (
        SELECT count(*)::int FROM public.tasks AS task_record
        WHERE task_record.project_id = v_existing_id
          AND task_record.owner_user_id = v_actor
      )
    );
  END IF;

  BEGIN
    INSERT INTO public.projects (
      owner_user_id,
      name,
      slug,
      description,
      template_operation_id
    )
    VALUES (
      v_actor,
      btrim(p_name),
      p_slug,
      NULLIF(btrim(p_description), ''),
      p_operation_id
    )
    RETURNING id INTO v_project_id;
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent identical submit won the operation receipt: return its
    -- project instead of surfacing a spurious conflict.
    SELECT project_record.id, project_record.slug
      INTO v_existing_id, v_existing_slug
    FROM public.projects AS project_record
    WHERE project_record.owner_user_id = v_actor
      AND project_record.template_operation_id = p_operation_id
    FOR UPDATE;

    IF v_existing_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'status', 'replayed',
        'project_id', v_existing_id,
        'slug', v_existing_slug,
        'goal_count', (
          SELECT count(*)::int FROM public.goals AS goal_record
          WHERE goal_record.project_id = v_existing_id
            AND goal_record.owner_user_id = v_actor
        ),
        'task_count', (
          SELECT count(*)::int FROM public.tasks AS task_record
          WHERE task_record.project_id = v_existing_id
            AND task_record.owner_user_id = v_actor
        )
      );
    END IF;

    -- Otherwise the (owner, slug) unique index refused the project. Nothing
    -- else has been inserted yet, so the transaction is clean.
    RETURN jsonb_build_object('status', 'slug_conflict');
  END;

  FOR i IN 0 .. v_goal_input_count - 1 LOOP
    INSERT INTO public.goals (owner_user_id, project_id, title, description, status)
    VALUES (
      v_actor,
      v_project_id,
      btrim(p_goals->i->>'title'),
      NULLIF(btrim(p_goals->i->>'description'), ''),
      p_goals->i->>'status'
    )
    RETURNING id INTO v_goal_id;

    v_goal_ids := v_goal_ids || v_goal_id;
    v_goal_count := v_goal_count + 1;
  END LOOP;

  INSERT INTO public.tasks (
    owner_user_id,
    project_id,
    goal_id,
    title,
    description,
    status,
    priority,
    estimate_minutes,
    due_date
  )
  SELECT
    v_actor,
    v_project_id,
    CASE
      WHEN task_item.value->'goal_index' IS NULL
        OR jsonb_typeof(task_item.value->'goal_index') = 'null'
      THEN NULL
      ELSE v_goal_ids[((task_item.value->>'goal_index')::int) + 1]
    END,
    btrim(task_item.value->>'title'),
    NULLIF(btrim(task_item.value->>'description'), ''),
    'todo',
    task_item.value->>'priority',
    CASE
      WHEN task_item.value ? 'estimate_minutes'
        AND jsonb_typeof(task_item.value->'estimate_minutes') <> 'null'
      THEN (task_item.value->>'estimate_minutes')::int
      ELSE NULL
    END,
    CASE
      WHEN task_item.value ? 'due_date'
        AND jsonb_typeof(task_item.value->'due_date') <> 'null'
      THEN (task_item.value->>'due_date')::date
      ELSE NULL
    END
  FROM jsonb_array_elements(p_tasks) AS task_item(value);

  GET DIAGNOSTICS v_task_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'status', 'created',
    'project_id', v_project_id,
    'slug', p_slug,
    'goal_count', v_goal_count,
    'task_count', v_task_count
  );
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.create_project_from_template(uuid, text, text, text, text, jsonb, jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.create_project_from_template(uuid, text, text, text, text, jsonb, jsonb) FROM anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.create_project_from_template(uuid, text, text, text, text, jsonb, jsonb) TO authenticated;

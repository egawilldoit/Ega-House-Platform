-- Reconcile legacy production ownership before enabling owner-scoped MCP RLS.
--
-- This migration is intentionally data-preserving and resolves generated IDs at
-- runtime. It repairs only null or nonexistent owners, then fails closed if any
-- owner remains invalid or differs from the parent project's owner.

DO $$
DECLARE
  v_target_owner uuid;
  v_target_count integer;
BEGIN
  SELECT count(*), min(id)
    INTO v_target_count, v_target_owner
  FROM auth.users
  WHERE lower(email) = 'ab.mortaki@gmail.com';

  IF v_target_count <> 1 OR v_target_owner IS NULL THEN
    RAISE EXCEPTION
      'Expected exactly one reconciliation owner for ab.mortaki@gmail.com; found %.',
      v_target_count;
  END IF;

  UPDATE public.projects AS project_record
  SET owner_user_id = v_target_owner,
      updated_at = now()
  WHERE project_record.owner_user_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM auth.users AS auth_user
       WHERE auth_user.id = project_record.owner_user_id
     );

  UPDATE public.goals AS goal_record
  SET owner_user_id = project_record.owner_user_id,
      updated_at = now()
  FROM public.projects AS project_record
  WHERE goal_record.project_id = project_record.id
    AND (
      goal_record.owner_user_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM auth.users AS auth_user
        WHERE auth_user.id = goal_record.owner_user_id
      )
    );

  UPDATE public.tasks AS task_record
  SET owner_user_id = project_record.owner_user_id,
      updated_at = now()
  FROM public.projects AS project_record
  WHERE task_record.project_id = project_record.id
    AND (
      task_record.owner_user_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM auth.users AS auth_user
        WHERE auth_user.id = task_record.owner_user_id
      )
    );

  IF EXISTS (
    SELECT 1
    FROM public.projects AS project_record
    WHERE project_record.owner_user_id IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM auth.users AS auth_user
         WHERE auth_user.id = project_record.owner_user_id
       )
  ) THEN
    RAISE EXCEPTION 'Project ownership reconciliation failed.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.goals AS goal_record
    JOIN public.projects AS project_record
      ON project_record.id = goal_record.project_id
    WHERE goal_record.owner_user_id IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM auth.users AS auth_user
         WHERE auth_user.id = goal_record.owner_user_id
       )
       OR goal_record.owner_user_id IS DISTINCT FROM project_record.owner_user_id
  ) THEN
    RAISE EXCEPTION 'Goal ownership does not match a valid parent project owner.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tasks AS task_record
    JOIN public.projects AS project_record
      ON project_record.id = task_record.project_id
    WHERE task_record.owner_user_id IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM auth.users AS auth_user
         WHERE auth_user.id = task_record.owner_user_id
       )
       OR task_record.owner_user_id IS DISTINCT FROM project_record.owner_user_id
  ) THEN
    RAISE EXCEPTION 'Task ownership does not match a valid parent project owner.';
  END IF;
END
$$;

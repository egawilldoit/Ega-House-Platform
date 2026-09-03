-- Atomic purge for archived projects (PROJECT PURGE V2).
--
-- A project purge removes an archived project together with its project-owned
-- work data (tasks, goals, timer sessions, external refs, task notifications,
-- calendar cleanup jobs) inside ONE PostgreSQL transaction. PostgREST cannot
-- span a transaction across separate Supabase calls, so the whole operation
-- lives in this SECURITY DEFINER function. Any statement failure rolls back
-- every preceding delete: partial purges are impossible by construction.
--
-- Classified preservation (enforced below, never altered here):
--   DELETE: tasks, goals, task_sessions, task_external_refs of the project;
--     task_reminders / task_recurrences via their existing task CASCADE;
--     notifications targeting those tasks (deliveries via existing CASCADE).
--   PRESERVE: idea_notes + task_saved_views unlink automatically through
--     their existing ON DELETE SET NULL references; agent_integration_events
--     and operator_proposals are historical evidence and are never touched.
-- Existing FK delete semantics are NOT changed by this migration.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.purge_archived_project(
  p_project_id uuid,
  p_confirmation_name text,
  p_expected_task_count integer,
  p_expected_goal_count integer
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid;
  v_project_name text;
  v_project_status text;
  v_task_ids uuid[];
  v_goal_ids uuid[];
  v_task_count integer;
  v_goal_count integer;
  v_tasks_deleted integer := 0;
  v_goals_deleted integer := 0;
  v_sessions_deleted integer := 0;
  v_external_refs_deleted integer := 0;
  v_notifications_deleted integer := 0;
  v_calendar_jobs_enqueued integer := 0;
BEGIN
  -- Direct authenticated user sessions only. Identity always comes from the
  -- verified JWT; the function accepts no owner/user id argument.
  v_actor := (SELECT auth.uid());
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL THEN
    RAISE EXCEPTION 'Direct user session required.' USING ERRCODE = '42501';
  END IF;

  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'Invalid project purge request.' USING ERRCODE = '22023';
  END IF;
  IF p_confirmation_name IS NULL OR btrim(p_confirmation_name) = '' THEN
    RAISE EXCEPTION 'Invalid project purge confirmation.' USING ERRCODE = '22023';
  END IF;
  IF p_expected_task_count IS NULL OR p_expected_task_count < 0
    OR p_expected_goal_count IS NULL OR p_expected_goal_count < 0 THEN
    RAISE EXCEPTION 'Invalid project purge counts.' USING ERRCODE = '22023';
  END IF;

  -- Lock the owned project row first so status/name/count checks and all
  -- deletes below observe one consistent snapshot.
  SELECT project_record.name, project_record.status
    INTO v_project_name, v_project_status
  FROM public.projects AS project_record
  WHERE project_record.id = p_project_id
    AND project_record.owner_user_id = v_actor
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF v_project_status IS NULL OR v_project_status <> 'archived' THEN
    RETURN jsonb_build_object('status', 'not_archived');
  END IF;

  -- Exact-name confirmation, compared against the locked row (defense in
  -- depth; the application already compared against its own read).
  IF p_confirmation_name <> v_project_name THEN
    RETURN jsonb_build_object('status', 'confirmation_mismatch');
  END IF;

  -- Recompute the impact inside the transaction: a preview that no longer
  -- matches the expected counts aborts before anything is deleted.
  SELECT COALESCE(array_agg(task_record.id), '{}'::uuid[])
    INTO v_task_ids
  FROM public.tasks AS task_record
  WHERE task_record.project_id = p_project_id
    AND task_record.owner_user_id = v_actor;

  SELECT COALESCE(array_agg(goal_record.id), '{}'::uuid[])
    INTO v_goal_ids
  FROM public.goals AS goal_record
  WHERE goal_record.project_id = p_project_id
    AND goal_record.owner_user_id = v_actor;

  v_task_count := coalesce(array_length(v_task_ids, 1), 0);
  v_goal_count := coalesce(array_length(v_goal_ids, 1), 0);

  IF v_task_count <> p_expected_task_count OR v_goal_count <> p_expected_goal_count THEN
    RETURN jsonb_build_object(
      'status', 'contents_changed',
      'task_count', v_task_count,
      'goal_count', v_goal_count
    );
  END IF;

  -- Enqueue Google Calendar cleanup BEFORE the task rows disappear. The
  -- existing calendar worker resolves delete jobs from the stored
  -- calendar_event_id even when the task row is gone. Never invent cleanup
  -- intent: skip tasks that already carry an active delete job.
  INSERT INTO public.calendar_sync_jobs (
    owner_user_id,
    task_id,
    calendar_event_id,
    operation,
    status,
    attempts
  )
  SELECT
    v_actor,
    task_record.id,
    task_record.calendar_event_id,
    'delete',
    'pending',
    0
  FROM public.tasks AS task_record
  WHERE task_record.id = ANY (v_task_ids)
    AND task_record.owner_user_id = v_actor
    AND task_record.calendar_event_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.calendar_sync_jobs AS existing_job
      WHERE existing_job.owner_user_id = v_actor
        AND existing_job.task_id = task_record.id
        AND existing_job.operation = 'delete'
        AND existing_job.status IN ('pending', 'processing', 'failed')
    );
  GET DIAGNOSTICS v_calendar_jobs_enqueued = ROW_COUNT;

  -- Task-targeted notifications first; their deliveries follow the existing
  -- notification CASCADE. Audit events and proposals are never touched.
  DELETE FROM public.notifications AS notification_record
  WHERE notification_record.owner_user_id = v_actor
    AND notification_record.target_type = 'task'
    AND notification_record.target_id = ANY (v_task_ids);
  GET DIAGNOSTICS v_notifications_deleted = ROW_COUNT;

  DELETE FROM public.task_external_refs AS external_ref
  WHERE external_ref.task_id = ANY (v_task_ids)
    AND external_ref.owner_user_id = v_actor;
  GET DIAGNOSTICS v_external_refs_deleted = ROW_COUNT;

  -- Timer history (including open sessions) is inside the confirmed scope.
  DELETE FROM public.task_sessions AS session_record
  WHERE session_record.task_id = ANY (v_task_ids)
    AND session_record.owner_user_id = v_actor;
  GET DIAGNOSTICS v_sessions_deleted = ROW_COUNT;

  -- Task reminders and recurrences follow their existing task CASCADE.
  DELETE FROM public.tasks AS task_record
  WHERE task_record.id = ANY (v_task_ids)
    AND task_record.owner_user_id = v_actor
    AND task_record.project_id = p_project_id;
  GET DIAGNOSTICS v_tasks_deleted = ROW_COUNT;

  DELETE FROM public.goals AS goal_record
  WHERE goal_record.id = ANY (v_goal_ids)
    AND goal_record.owner_user_id = v_actor
    AND goal_record.project_id = p_project_id;
  GET DIAGNOSTICS v_goals_deleted = ROW_COUNT;

  -- idea_notes.project_id and task_saved_views references unlink
  -- automatically through their existing ON DELETE SET NULL behavior.
  DELETE FROM public.projects AS project_record
  WHERE project_record.id = p_project_id
    AND project_record.owner_user_id = v_actor;

  RETURN jsonb_build_object(
    'status', 'purged',
    'tasks_deleted', v_tasks_deleted,
    'goals_deleted', v_goals_deleted,
    'sessions_deleted', v_sessions_deleted,
    'external_refs_deleted', v_external_refs_deleted,
    'notifications_deleted', v_notifications_deleted,
    'calendar_delete_jobs_enqueued', v_calendar_jobs_enqueued
  );
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.purge_archived_project(uuid, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_archived_project(uuid, text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.purge_archived_project(uuid, text, integer, integer) TO authenticated;

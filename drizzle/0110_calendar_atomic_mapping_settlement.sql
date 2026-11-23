-- Settle provider-confirmed mappings under the same claim as job completion.
CREATE OR REPLACE FUNCTION public.calendar_sync_complete_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_outcome varchar,
  p_event_id text,
  p_generation integer,
  p_payload_hash text,
  p_exclusion_reason text,
  p_last_error text,
  p_permanent_failure boolean,
  p_remove_mapping boolean,
  p_removed_event_id text,
  p_removed_generation integer,
  p_now timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $complete_job$
DECLARE
  v_job public.calendar_sync_jobs;
BEGIN
  IF p_claim_token IS NULL THEN
    RETURN false;
  END IF;

  SELECT job.* INTO v_job
  FROM public.calendar_sync_jobs AS job
  WHERE job.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_job.status <> 'processing'
    OR v_job.claim_token IS DISTINCT FROM p_claim_token
    OR v_job.lease_expires_at IS NULL
    OR v_job.lease_expires_at <= clock_timestamp() THEN
    RETURN false;
  END IF;

  IF p_outcome IN ('created', 'updated') AND p_event_id IS NOT NULL THEN
    INSERT INTO public.calendar_event_mappings (
      owner_user_id, task_id, destination_key, google_account_subject,
      google_account_email, calendar_id, event_id, generation, status,
      metadata_verified, payload_hash, last_synced_at, updated_at
    ) VALUES (
      v_job.owner_user_id, v_job.task_id, v_job.destination_key,
      v_job.google_account_subject, v_job.google_account_email, v_job.calendar_id,
      p_event_id, greatest(p_generation, 1), 'active', true, p_payload_hash, p_now, p_now
    ) ON CONFLICT (owner_user_id, task_id, destination_key) DO UPDATE
    SET event_id = EXCLUDED.event_id, generation = EXCLUDED.generation,
        google_account_subject = EXCLUDED.google_account_subject,
        google_account_email = EXCLUDED.google_account_email,
        calendar_id = EXCLUDED.calendar_id, status = 'active',
        metadata_verified = true, payload_hash = EXCLUDED.payload_hash,
        last_synced_at = p_now, updated_at = p_now
    WHERE public.calendar_event_mappings.generation <= EXCLUDED.generation;
    IF NOT FOUND THEN
      RETURN false;
    END IF;
  END IF;

  IF p_remove_mapping
    AND p_removed_event_id IS NOT NULL
    AND p_removed_generation IS NOT NULL THEN
    -- A first publish can reach Google without ever creating an active mapping.
    -- Keep the removed generation so a later publish does not reuse its event ID.
    INSERT INTO public.calendar_event_mappings AS mapping (
      owner_user_id, task_id, destination_key, google_account_subject,
      google_account_email, calendar_id, event_id, generation, status,
      metadata_verified, updated_at
    ) VALUES (
      v_job.owner_user_id, v_job.task_id, v_job.destination_key,
      v_job.google_account_subject, v_job.google_account_email, v_job.calendar_id,
      p_removed_event_id, p_removed_generation, 'removed', true, p_now
    ) ON CONFLICT (owner_user_id, task_id, destination_key) DO UPDATE
    SET status = 'removed', metadata_verified = true, updated_at = p_now,
        event_id = EXCLUDED.event_id, generation = EXCLUDED.generation,
        payload_hash = NULL
    WHERE mapping.generation < EXCLUDED.generation
       OR (mapping.generation = EXCLUDED.generation
           AND mapping.event_id = EXCLUDED.event_id
           AND mapping.status = 'active');
  END IF;

  UPDATE public.calendar_sync_jobs
  SET status = 'succeeded',
      outcome = p_outcome,
      calendar_event_id = p_event_id,
      generation = p_generation,
      event_exists = (p_event_id IS NOT NULL),
      payload_hash = p_payload_hash,
      exclusion_reason = p_exclusion_reason,
      last_error = p_last_error,
      permanent_failure = p_permanent_failure,
      claim_token = NULL,
      lease_expires_at = NULL,
      locked_at = NULL,
      updated_at = p_now
  WHERE id = v_job.id;

  IF v_job.run_id IS NOT NULL THEN
    UPDATE public.calendar_sync_run_items
    SET outcome = p_outcome,
        exclusion_reason = p_exclusion_reason,
        event_id = p_event_id,
        payload_hash = p_payload_hash,
        error_message = p_last_error,
        job_id = v_job.id,
        updated_at = p_now
    WHERE run_id = v_job.run_id
      AND task_id = v_job.task_id;
  END IF;

  RETURN true;
END
$complete_job$;
--> statement-breakpoint

-- Promote only a claimed legacy first-publish job. A newer pending v2 intent
-- wins if one was queued while the legacy job was being claimed.
CREATE OR REPLACE FUNCTION public.calendar_sync_promote_legacy_job(
  p_job_id uuid, p_claim_token uuid, p_now timestamptz
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $promote$
DECLARE v_job public.calendar_sync_jobs;
BEGIN
  SELECT * INTO v_job FROM public.calendar_sync_jobs
  WHERE id = p_job_id AND queue_version = 1 AND status = 'processing'
    AND claim_token = p_claim_token AND lease_expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  BEGIN
    UPDATE public.calendar_sync_jobs
    SET queue_version = 2, status = 'pending', claim_token = NULL, locked_at = NULL,
        lease_expires_at = NULL, updated_at = p_now
    WHERE id = p_job_id;
  EXCEPTION WHEN unique_violation THEN
    IF EXISTS (SELECT 1 FROM public.calendar_sync_jobs AS newer
      WHERE newer.owner_user_id = v_job.owner_user_id
        AND newer.task_id = v_job.task_id
        AND newer.destination_key = v_job.destination_key
        AND newer.queue_version = 2 AND newer.status = 'pending') THEN
      DELETE FROM public.calendar_sync_jobs WHERE id = p_job_id;
    ELSE
      RAISE;
    END IF;
  END;
  RETURN true;
END
$promote$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.calendar_sync_promote_legacy_job(uuid, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_sync_promote_legacy_job(uuid, uuid, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.calendar_sync_complete_legacy_job(
  p_job_id uuid, p_claim_token uuid, p_status text, p_task_status text,
  p_event_id text, p_failure_reason text, p_update_task boolean, p_now timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $legacy_complete$
DECLARE v_job public.calendar_sync_jobs;
BEGIN
  SELECT * INTO v_job FROM public.calendar_sync_jobs
  WHERE id = p_job_id AND queue_version = 1 AND status = 'processing'
    AND claim_token = p_claim_token AND lease_expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_status = 'succeeded' AND p_event_id IS NOT NULL AND v_job.operation <> 'delete' THEN
    PERFORM public.calendar_sync_upsert_mapping(v_job.owner_user_id, v_job.task_id,
      v_job.destination_key, v_job.google_account_subject, v_job.google_account_email,
      v_job.calendar_id, p_event_id, v_job.generation, NULL, p_now);
    IF NOT FOUND THEN RAISE EXCEPTION 'Calendar mapping was not persisted'; END IF;
  END IF;
  IF p_status = 'succeeded' AND p_event_id IS NULL AND v_job.event_exists
    AND v_job.calendar_event_id IS NOT NULL THEN
    UPDATE public.calendar_event_mappings AS mapping SET status = 'removed', updated_at = p_now
    WHERE mapping.owner_user_id = v_job.owner_user_id AND mapping.task_id = v_job.task_id
      AND mapping.destination_key = v_job.destination_key AND mapping.status = 'active'
      AND mapping.event_id = v_job.calendar_event_id AND mapping.generation = v_job.generation;
  END IF;
  UPDATE public.calendar_sync_jobs SET status = p_status, attempts = attempts + 1,
    last_error = p_failure_reason, claim_token = NULL, locked_at = NULL,
    lease_expires_at = NULL, updated_at = p_now WHERE id = v_job.id;
  IF p_update_task THEN
    UPDATE public.tasks SET calendar_sync_status = p_task_status,
      calendar_event_id = p_event_id, calendar_sync_failure_reason = p_failure_reason,
      updated_at = p_now WHERE id = v_job.task_id AND owner_user_id = v_job.owner_user_id;
  END IF;
  RETURN true;
END
$legacy_complete$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.calendar_sync_complete_legacy_job(uuid, uuid, text, text, text, text, boolean, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_sync_complete_legacy_job(uuid, uuid, text, text, text, text, boolean, timestamptz) TO authenticated, service_role;

--> statement-breakpoint
-- Keep a verified event discoverable across retries and queue coalescing.
CREATE OR REPLACE FUNCTION public.calendar_sync_prepare_removal(
  p_job_id uuid, p_claim_token uuid, p_event_id text, p_now timestamptz
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $prepare_removal$
DECLARE v_job public.calendar_sync_jobs;
BEGIN
  SELECT job.* INTO v_job
  FROM public.calendar_sync_jobs AS job
  WHERE job.id = p_job_id AND job.queue_version = 2
    AND job.status = 'processing' AND job.claim_token = p_claim_token
    AND job.lease_expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  INSERT INTO public.calendar_event_mappings AS mapping (
    owner_user_id, task_id, destination_key, google_account_subject,
    google_account_email, calendar_id, event_id, generation, status,
    metadata_verified, updated_at
  ) VALUES (
    v_job.owner_user_id, v_job.task_id, v_job.destination_key,
    v_job.google_account_subject, v_job.google_account_email, v_job.calendar_id,
    p_event_id, v_job.generation, 'active', true, p_now
  ) ON CONFLICT (owner_user_id, task_id, destination_key) DO UPDATE
  SET event_id = EXCLUDED.event_id, generation = EXCLUDED.generation,
      status = 'active', metadata_verified = true, payload_hash = NULL,
      updated_at = p_now
  WHERE mapping.generation < EXCLUDED.generation
     OR (mapping.generation = EXCLUDED.generation
         AND mapping.event_id = EXCLUDED.event_id AND mapping.status = 'active');
  RETURN FOUND;
END
$prepare_removal$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.calendar_sync_prepare_removal(uuid, uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_sync_prepare_removal(uuid, uuid, text, timestamptz) TO authenticated, service_role;
--> statement-breakpoint

CREATE FUNCTION public.calendar_sync_requeue_retryable_jobs(
  p_run_id uuid, p_destination_key text, p_now timestamptz
) RETURNS integer
LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $retry$
  WITH requeued AS (
    UPDATE public.calendar_sync_jobs AS job
    SET status = 'pending', attempts = 0, scheduled_at = LEAST(p_now, now()),
        last_error = NULL, claim_token = NULL, lease_expires_at = NULL,
        updated_at = p_now
    WHERE job.run_id = p_run_id AND job.destination_key = p_destination_key
      AND job.queue_version = 2 AND NOT job.permanent_failure
      AND (job.status = 'failed' OR (job.status = 'pending' AND job.attempts > 0))
      AND EXISTS (
        SELECT 1 FROM public.calendar_sync_run_items AS item
        WHERE item.run_id = p_run_id AND item.job_id = job.id
          AND item.outcome IN ('failed', 'pending')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.calendar_sync_jobs AS other
        WHERE other.owner_user_id = job.owner_user_id AND other.task_id = job.task_id
          AND other.destination_key = job.destination_key AND other.queue_version = 2
          AND (
            other.status = 'processing'
            OR (job.status = 'failed' AND other.status = 'pending')
            OR (job.status = 'failed' AND other.status = 'failed'
                AND NOT other.permanent_failure AND other.run_id = p_run_id
                AND (other.updated_at, other.id) > (job.updated_at, job.id))
          )
      )
    RETURNING job.id, job.task_id
  ), reset_items AS (
    UPDATE public.calendar_sync_run_items AS item
    SET outcome = 'pending', error_message = NULL, job_id = requeued.id, updated_at = p_now
    FROM requeued WHERE item.run_id = p_run_id AND item.task_id = requeued.task_id
  )
  SELECT count(*)::integer FROM requeued;
$retry$;
--> statement-breakpoint

CREATE FUNCTION public.calendar_sync_complete_run_if_drained(
  p_run_id uuid, p_now timestamptz
) RETURNS SETOF public.calendar_sync_runs
LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $drained$
  UPDATE public.calendar_sync_runs AS run
  SET status = 'completed', completed_at = p_now, updated_at = p_now
  WHERE run.id = p_run_id AND run.status = 'active' AND run.scan_complete
    AND NOT EXISTS (
      SELECT 1 FROM public.calendar_sync_jobs
      WHERE run_id = run.id AND status IN ('pending', 'processing')
    )
  RETURNING run.*;
$drained$;
--> statement-breakpoint

CREATE FUNCTION public.calendar_sync_claim_is_current(p_job_id uuid, p_claim_token uuid)
RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $current$
  SELECT EXISTS (
    SELECT 1 FROM public.calendar_sync_jobs
    WHERE id = p_job_id AND status = 'processing' AND claim_token = p_claim_token
      AND lease_expires_at > clock_timestamp()
  );
$current$;
--> statement-breakpoint

CREATE FUNCTION public.calendar_sync_advance_generation(
  p_job_id uuid, p_claim_token uuid, p_generation integer, p_event_id text,
  p_payload_hash text, p_now timestamptz
) RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $advance$
  WITH advanced AS (
    UPDATE public.calendar_sync_jobs
    SET generation = p_generation, event_exists = false, calendar_event_id = p_event_id,
        payload_hash = p_payload_hash, updated_at = p_now
    WHERE id = p_job_id AND status = 'processing' AND claim_token = p_claim_token
      AND lease_expires_at > clock_timestamp()
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM advanced);
$advance$;
--> statement-breakpoint

CREATE FUNCTION public.calendar_sync_fail_claim(
  p_job_id uuid, p_claim_token uuid, p_outcome text, p_exclusion_reason text,
  p_last_error text, p_permanent boolean, p_now timestamptz
) RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $fail$
  WITH failed AS (
    UPDATE public.calendar_sync_jobs
    SET status = 'failed', outcome = p_outcome, exclusion_reason = p_exclusion_reason,
        last_error = p_last_error, permanent_failure = p_permanent, scheduled_at = p_now,
        claim_token = NULL, lease_expires_at = NULL, locked_at = NULL, updated_at = p_now
    WHERE id = p_job_id AND status = 'processing' AND claim_token = p_claim_token
      AND lease_expires_at > clock_timestamp()
    RETURNING id, run_id, task_id, calendar_event_id, payload_hash
  ), failed_items AS (
    UPDATE public.calendar_sync_run_items AS item
    SET outcome = 'failed', exclusion_reason = p_exclusion_reason,
        event_id = failed.calendar_event_id, payload_hash = failed.payload_hash,
        error_message = p_last_error, updated_at = p_now
    FROM failed
    WHERE item.run_id = failed.run_id AND item.task_id = failed.task_id
      AND item.job_id = failed.id
  )
  SELECT EXISTS (SELECT 1 FROM failed);
$fail$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION
  public.calendar_sync_requeue_retryable_jobs(uuid, text, timestamptz),
  public.calendar_sync_complete_run_if_drained(uuid, timestamptz),
  public.calendar_sync_claim_is_current(uuid, uuid),
  public.calendar_sync_advance_generation(uuid, uuid, integer, text, text, timestamptz),
  public.calendar_sync_fail_claim(uuid, uuid, text, text, text, boolean, timestamptz)
FROM PUBLIC, anon;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION
  public.calendar_sync_requeue_retryable_jobs(uuid, text, timestamptz),
  public.calendar_sync_complete_run_if_drained(uuid, timestamptz),
  public.calendar_sync_claim_is_current(uuid, uuid),
  public.calendar_sync_advance_generation(uuid, uuid, integer, text, text, timestamptz),
  public.calendar_sync_fail_claim(uuid, uuid, text, text, text, boolean, timestamptz)
TO authenticated, service_role;
--> statement-breakpoint

CREATE FUNCTION public.calendar_sync_list_actionable_runs(p_limit integer)
RETURNS SETOF public.calendar_sync_runs
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $actionable$
  SELECT run.*
  FROM public.calendar_sync_runs AS run
  WHERE run.status = 'active'
    AND (
      NOT run.scan_complete
      OR EXISTS (
        SELECT 1 FROM public.calendar_sync_jobs AS job
        WHERE job.run_id = run.id
          AND ((job.status = 'pending' AND job.attempts < 8 AND NOT job.permanent_failure
                 AND (job.attempts = 0 OR job.scheduled_at <= now()))
               OR (job.status = 'processing' AND job.lease_expires_at <= now()))
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.calendar_sync_jobs AS job
        WHERE job.run_id = run.id AND job.status IN ('pending', 'processing')
      )
    )
  ORDER BY run.updated_at, run.id
  LIMIT greatest(p_limit, 1);
$actionable$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.calendar_sync_list_actionable_runs(integer) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.calendar_sync_list_actionable_runs(integer) TO authenticated, service_role;

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

  -- Cleanup follows the verified destination of each still-active mapping.
  INSERT INTO public.calendar_sync_jobs (
    owner_user_id, task_id, calendar_event_id, operation, status, attempts,
    queue_version, destination_key, google_account_subject, google_account_email,
    calendar_id, generation, event_exists
  )
  SELECT
    mapping.owner_user_id, mapping.task_id, mapping.event_id, 'delete', 'pending', 0,
    2, mapping.destination_key, mapping.google_account_subject, mapping.google_account_email,
    mapping.calendar_id, mapping.generation, true
  FROM public.calendar_event_mappings AS mapping
  WHERE mapping.owner_user_id = v_actor
    AND mapping.task_id = ANY (v_task_ids)
    AND mapping.status = 'active'
  ON CONFLICT (owner_user_id, task_id, destination_key)
    WHERE (status = 'pending' AND queue_version = 2)
  DO UPDATE SET
    operation = 'delete',
    calendar_event_id = CASE WHEN calendar_sync_jobs.generation > EXCLUDED.generation
      THEN COALESCE(calendar_sync_jobs.calendar_event_id, EXCLUDED.calendar_event_id)
      ELSE EXCLUDED.calendar_event_id END,
    generation = CASE WHEN calendar_sync_jobs.calendar_event_id IS NOT NULL
      THEN greatest(calendar_sync_jobs.generation, EXCLUDED.generation)
      ELSE EXCLUDED.generation END,
    event_exists = EXCLUDED.generation >= calendar_sync_jobs.generation
      OR calendar_sync_jobs.calendar_event_id IS NULL,
    attempts = 0,
    status = 'pending',
    scheduled_at = now(),
    last_error = NULL,
    permanent_failure = false,
    updated_at = now();
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

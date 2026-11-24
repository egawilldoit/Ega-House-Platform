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

CREATE FUNCTION public.calendar_sync_resume_run_for_retry(
  p_run_id uuid, p_destination_key text, p_retry_mode boolean, p_now timestamptz
) RETURNS SETOF public.calendar_sync_runs
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $retry$
BEGIN
  PERFORM 1 FROM public.calendar_sync_runs
  WHERE id = p_run_id AND destination_key = p_destination_key
    AND (status IN ('active', 'paused') OR (p_retry_mode AND status = 'completed'))
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF p_retry_mode THEN
    WITH requeued AS (
      UPDATE public.calendar_sync_jobs AS job
      SET status = 'pending', attempts = 0, scheduled_at = LEAST(p_now, now()),
          last_error = NULL, claim_token = NULL, lease_expires_at = NULL,
          updated_at = p_now
      WHERE job.run_id = p_run_id AND job.destination_key = p_destination_key
        AND job.queue_version = 2 AND NOT job.permanent_failure
        AND (job.status = 'failed' OR (job.status = 'pending' AND job.attempts > 0))
        AND job.scheduled_at <= p_now
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
    )
    UPDATE public.calendar_sync_run_items AS item
    SET outcome = 'pending', error_message = NULL, job_id = requeued.id, updated_at = p_now
    FROM requeued WHERE item.run_id = p_run_id AND item.task_id = requeued.task_id;
  END IF;

  RETURN QUERY UPDATE public.calendar_sync_runs
  SET status = 'active', retry_mode = p_retry_mode, last_error = NULL,
      next_retry_at = NULL, completed_at = NULL, updated_at = p_now
  WHERE id = p_run_id
  RETURNING *;
END
$retry$;
--> statement-breakpoint

CREATE FUNCTION public.calendar_sync_complete_run_if_drained(
  p_run_id uuid, p_now timestamptz
) RETURNS SETOF public.calendar_sync_runs
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $drained$
BEGIN
  PERFORM 1 FROM public.calendar_sync_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY UPDATE public.calendar_sync_runs AS run
  SET status = 'completed', completed_at = p_now, updated_at = p_now
  WHERE run.id = p_run_id AND run.status = 'active' AND run.scan_complete
    AND NOT EXISTS (
      SELECT 1 FROM public.calendar_sync_jobs
      WHERE run_id = run.id AND status IN ('pending', 'processing')
    )
  RETURNING run.*;
END
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
  public.calendar_sync_resume_run_for_retry(uuid, text, boolean, timestamptz),
  public.calendar_sync_complete_run_if_drained(uuid, timestamptz),
  public.calendar_sync_claim_is_current(uuid, uuid),
  public.calendar_sync_advance_generation(uuid, uuid, integer, text, text, timestamptz),
  public.calendar_sync_fail_claim(uuid, uuid, text, text, text, boolean, timestamptz)
FROM PUBLIC, anon;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION
  public.calendar_sync_resume_run_for_retry(uuid, text, boolean, timestamptz),
  public.calendar_sync_complete_run_if_drained(uuid, timestamptz),
  public.calendar_sync_claim_is_current(uuid, uuid),
  public.calendar_sync_advance_generation(uuid, uuid, integer, text, text, timestamptz),
  public.calendar_sync_fail_claim(uuid, uuid, text, text, text, boolean, timestamptz)
TO authenticated, service_role;
--> statement-breakpoint

CREATE FUNCTION public.calendar_sync_list_actionable_runs(p_limit integer)
RETURNS SETOF public.calendar_sync_runs
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $actionable$
  SELECT run.*
  FROM public.calendar_sync_runs AS run
  WHERE run.status = 'active'
    AND (
      (NOT run.scan_complete
        AND (run.next_retry_at IS NULL OR run.next_retry_at <= clock_timestamp()))
      OR EXISTS (
        SELECT 1 FROM public.calendar_sync_jobs AS job
        WHERE job.run_id = run.id
          AND ((job.status = 'pending' AND job.attempts < 8 AND NOT job.permanent_failure
                 AND job.scheduled_at <= clock_timestamp())
               OR (job.status = 'processing' AND job.lease_expires_at <= clock_timestamp()))
      )
      OR (run.scan_complete AND NOT EXISTS (
        SELECT 1 FROM public.calendar_sync_jobs AS job
        WHERE job.run_id = run.id AND job.status IN ('pending', 'processing')
      ))
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
  v_legacy_jobs_enqueued integer := 0;
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

  -- Retain legacy cleanup evidence without guessing a destination. Tasks without
  -- an active destination-bound mapping have no durable proof of which account
  -- or calendar owns tasks.calendar_event_id (a later edit advances
  -- tasks.updated_at even after a calendar switch), so keep the row unbound for
  -- reconciliation rather than risking deletion in the wrong calendar.
  INSERT INTO public.calendar_sync_jobs (
    owner_user_id, task_id, calendar_event_id, operation, status, attempts,
    destination_key, google_account_subject, google_account_email, calendar_id, event_exists
  )
  SELECT v_actor, task_record.id, task_record.calendar_event_id, 'delete', 'pending', 0,
    '', NULL, NULL, NULL, false
  FROM public.tasks AS task_record
  WHERE task_record.owner_user_id = v_actor AND task_record.id = ANY (v_task_ids)
    AND task_record.calendar_event_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.calendar_event_mappings AS mapping
      WHERE mapping.owner_user_id = v_actor AND mapping.task_id = task_record.id
        AND mapping.status = 'active'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.calendar_sync_jobs AS existing_job
      WHERE existing_job.owner_user_id = v_actor AND existing_job.task_id = task_record.id
        AND existing_job.operation = 'delete'
        AND (existing_job.status IN ('pending', 'processing')
          OR (existing_job.status = 'failed' AND existing_job.attempts < 5))
    );
  GET DIAGNOSTICS v_legacy_jobs_enqueued = ROW_COUNT;
  v_calendar_jobs_enqueued := v_calendar_jobs_enqueued + v_legacy_jobs_enqueued;

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

CREATE FUNCTION public.calendar_sync_enqueue_job(
  p_owner_user_id uuid, p_task_id uuid, p_calendar_event_id text, p_operation text,
  p_destination_key text, p_google_account_subject text, p_google_account_email text,
  p_calendar_id text, p_generation integer, p_event_exists boolean, p_now timestamptz
) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $enqueue$
  INSERT INTO public.calendar_sync_jobs (
    owner_user_id, task_id, calendar_event_id, operation, status, attempts,
    queue_version, destination_key, google_account_subject, google_account_email,
    calendar_id, generation, event_exists, scheduled_at, updated_at
  ) VALUES (
    p_owner_user_id, p_task_id, p_calendar_event_id, p_operation, 'pending', 0,
    2, p_destination_key, p_google_account_subject, p_google_account_email,
    p_calendar_id, p_generation, p_event_exists, LEAST(p_now, now()), p_now
  )
  ON CONFLICT (owner_user_id, task_id, destination_key)
    WHERE (status = 'pending' AND queue_version = 2)
  DO UPDATE SET
    operation = EXCLUDED.operation,
    calendar_event_id = CASE WHEN calendar_sync_jobs.generation > EXCLUDED.generation
      THEN COALESCE(calendar_sync_jobs.calendar_event_id, EXCLUDED.calendar_event_id)
      ELSE EXCLUDED.calendar_event_id END,
    generation = CASE WHEN calendar_sync_jobs.calendar_event_id IS NOT NULL
      THEN greatest(calendar_sync_jobs.generation, EXCLUDED.generation)
      ELSE EXCLUDED.generation END,
    event_exists = EXCLUDED.event_exists AND
      (EXCLUDED.generation >= calendar_sync_jobs.generation OR calendar_sync_jobs.calendar_event_id IS NULL),
    attempts = 0,
    scheduled_at = LEAST(calendar_sync_jobs.scheduled_at, p_now, now()),
    last_error = NULL,
    permanent_failure = false,
    updated_at = p_now;
$enqueue$;
--> statement-breakpoint

CREATE FUNCTION public.calendar_sync_list_ready_destinations(p_owner uuid, p_limit integer)
RETURNS TABLE (
  owner_user_id uuid, destination_key text, google_account_subject text,
  google_account_email text, calendar_id text
)
LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $ready$
  WITH matched AS (
    SELECT job.owner_user_id, job.destination_key,
      COALESCE(NULLIF(trim(settings.google_account_subject), ''), job.google_account_subject) AS google_account_subject,
      COALESCE(NULLIF(lower(trim(settings.google_account_email)), ''), job.google_account_email) AS google_account_email,
      COALESCE(NULLIF(trim(settings.calendar_id), ''), 'primary') AS calendar_id,
      job.scheduled_at
    FROM public.calendar_sync_jobs AS job
    JOIN public.calendar_integration_settings AS settings
      ON settings.owner_user_id = job.owner_user_id AND settings.provider = 'google'
    CROSS JOIN LATERAL (
      SELECT NULLIF(lower(trim(job.google_account_email)), '') AS job_email,
        NULLIF(trim(job.google_account_subject), '') AS job_subject,
        NULLIF(lower(trim(settings.google_account_email)), '') AS settings_email,
        NULLIF(trim(settings.google_account_subject), '') AS settings_subject
    ) AS identity
    WHERE (p_owner IS NULL OR job.owner_user_id = p_owner)
      AND job.queue_version = 2 AND job.run_id IS NULL AND NOT job.permanent_failure
      AND ((job.status = 'pending' AND job.attempts < 8 AND job.scheduled_at <= clock_timestamp())
        OR (job.status = 'processing' AND job.lease_expires_at <= clock_timestamp()))
      AND settings.connected_at IS NOT NULL AND settings.disconnected_at IS NULL
      AND settings.reconnect_required_at IS NULL
      AND (settings.access_token_encrypted IS NOT NULL OR settings.refresh_token_encrypted IS NOT NULL)
      AND NULLIF(trim(job.calendar_id), '') = COALESCE(NULLIF(trim(settings.calendar_id), ''), 'primary')
      AND COALESCE(identity.job_email, '') <> 'unknown-account'
      AND COALESCE(identity.job_subject, '') <> 'unknown-account'
      AND COALESCE(identity.settings_email, '') <> 'unknown-account'
      AND COALESCE(identity.settings_subject, '') <> 'unknown-account'
      AND CASE WHEN identity.job_email IS NOT NULL AND identity.settings_email IS NOT NULL
        THEN identity.job_email = identity.settings_email
        ELSE identity.job_subject = identity.settings_subject
      END
  ),
  deduped AS (
    SELECT DISTINCT ON (matched.owner_user_id, matched.destination_key)
      matched.owner_user_id, matched.destination_key,
      matched.google_account_subject, matched.google_account_email,
      matched.calendar_id, matched.scheduled_at
    FROM matched
    ORDER BY matched.owner_user_id, matched.destination_key, matched.scheduled_at,
      matched.google_account_subject NULLS LAST, matched.google_account_email NULLS LAST
  )
  SELECT deduped.owner_user_id, deduped.destination_key,
    deduped.google_account_subject, deduped.google_account_email, deduped.calendar_id
  FROM deduped
  ORDER BY deduped.scheduled_at, deduped.owner_user_id, deduped.destination_key
  LIMIT greatest(p_limit, 1);
$ready$;
--> statement-breakpoint

CREATE FUNCTION public.calendar_sync_fail_unclaimed_listing(
  p_run_id uuid,
  p_expected_cursor_created_at timestamptz,
  p_expected_cursor_task_id uuid,
  p_pause boolean,
  p_retry_at timestamptz,
  p_error text,
  p_now timestamptz
) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $listing_fail$
  WITH updated AS (
    UPDATE public.calendar_sync_runs
    SET status = CASE WHEN p_pause THEN 'paused' ELSE status END,
        next_retry_at = CASE WHEN p_pause THEN NULL ELSE p_retry_at END,
        last_error = left(p_error, 500),
        updated_at = p_now
    WHERE id = p_run_id
      AND status = 'active'
      AND NOT scan_complete
      AND scan_cursor_created_at IS NOT DISTINCT FROM p_expected_cursor_created_at
      AND scan_cursor_task_id IS NOT DISTINCT FROM p_expected_cursor_task_id
      AND (
        scan_claim_token IS NULL
        OR scan_lease_expires_at IS NULL
        OR scan_lease_expires_at <= clock_timestamp()
      )
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM updated);
$listing_fail$;
--> statement-breakpoint

CREATE FUNCTION public.calendar_sync_pause_for_authorization(
  p_owner_user_id uuid,
  p_expected_updated_at timestamptz,
  p_expected_connected_at timestamptz,
  p_expected_access_token_encrypted text,
  p_expected_refresh_token_encrypted text,
  p_run_id uuid,
  p_fence_listing boolean,
  p_expected_cursor_created_at timestamptz,
  p_expected_cursor_task_id uuid,
  p_error text,
  p_now timestamptz
) RETURNS TABLE (
  credentials_marked boolean,
  run_paused boolean
)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
AS $auth_pause$
DECLARE
  v_paused boolean := false;
BEGIN
  UPDATE public.calendar_integration_settings
  SET reconnect_required_at = p_now,
      reconnect_required_reason = left(p_error, 500),
      updated_at = p_now
  WHERE owner_user_id = p_owner_user_id
    AND provider = 'google'
    AND updated_at = p_expected_updated_at
    AND connected_at IS NOT DISTINCT FROM p_expected_connected_at
    AND access_token_encrypted IS NOT DISTINCT FROM p_expected_access_token_encrypted
    AND refresh_token_encrypted IS NOT DISTINCT FROM p_expected_refresh_token_encrypted;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false;
    RETURN;
  END IF;

  IF p_run_id IS NOT NULL THEN
    IF p_fence_listing THEN
      UPDATE public.calendar_sync_runs
      SET status = 'paused',
          next_retry_at = NULL,
          last_error = left(p_error, 500),
          updated_at = p_now
      WHERE id = p_run_id
        AND owner_user_id = p_owner_user_id
        AND status = 'active'
        AND NOT scan_complete
        AND scan_cursor_created_at IS NOT DISTINCT FROM p_expected_cursor_created_at
        AND scan_cursor_task_id IS NOT DISTINCT FROM p_expected_cursor_task_id
        AND (
          scan_claim_token IS NULL
          OR scan_lease_expires_at IS NULL
          OR scan_lease_expires_at <= clock_timestamp()
        );
      v_paused := FOUND;
    ELSE
      UPDATE public.calendar_sync_runs
      SET status = 'paused',
          next_retry_at = NULL,
          last_error = left(p_error, 500),
          updated_at = p_now
      WHERE id = p_run_id
        AND owner_user_id = p_owner_user_id
        AND status = 'active';
      v_paused := FOUND;
    END IF;
  END IF;

  RETURN QUERY SELECT true, v_paused;
END;
$auth_pause$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION
  public.calendar_sync_enqueue_job(uuid, uuid, text, text, text, text, text, text, integer, boolean, timestamptz),
  public.calendar_sync_list_ready_destinations(uuid, integer),
  public.calendar_sync_fail_unclaimed_listing(uuid, timestamptz, uuid, boolean, timestamptz, text, timestamptz),
  public.calendar_sync_pause_for_authorization(uuid, timestamptz, timestamptz, text, text, uuid, boolean, timestamptz, uuid, text, timestamptz)
FROM PUBLIC, anon;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION
  public.calendar_sync_enqueue_job(uuid, uuid, text, text, text, text, text, text, integer, boolean, timestamptz),
  public.calendar_sync_list_ready_destinations(uuid, integer),
  public.calendar_sync_fail_unclaimed_listing(uuid, timestamptz, uuid, boolean, timestamptz, text, timestamptz),
  public.calendar_sync_pause_for_authorization(uuid, timestamptz, timestamptz, text, text, uuid, boolean, timestamptz, uuid, text, timestamptz)
TO authenticated, service_role;

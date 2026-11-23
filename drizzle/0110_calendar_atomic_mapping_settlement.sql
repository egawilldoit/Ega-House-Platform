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
    UPDATE public.calendar_event_mappings AS mapping
    SET status = 'removed',
        metadata_verified = true,
        updated_at = p_now
    WHERE mapping.owner_user_id = v_job.owner_user_id
      AND mapping.task_id = v_job.task_id
      AND mapping.destination_key = v_job.destination_key
      AND mapping.status = 'active'
      AND mapping.event_id = p_removed_event_id
      AND mapping.generation = p_removed_generation;
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

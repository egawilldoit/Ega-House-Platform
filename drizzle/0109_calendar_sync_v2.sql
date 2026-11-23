-- Calendar sync v2: resumable manual sync, destination-bound mappings and a
-- durable coalesced queue.
--
-- Compatibility notes:
-- * Existing calendar_integration_settings rows keep their tokens and calendar.
-- * Existing calendar_sync_jobs rows stay queue_version = 1 and are still
--   processed by the legacy scheduled-sync drain.
-- * tasks.calendar_event_id is preserved and adopted as a legacy mapping.
-- * No event is deleted by this migration.

ALTER TABLE public.calendar_integration_settings
  ADD COLUMN IF NOT EXISTS google_account_subject text,
  ADD COLUMN IF NOT EXISTS reconnect_required_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconnect_required_reason text;

CREATE TABLE IF NOT EXISTS public.calendar_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL DEFAULT auth.uid(),
  destination_key text NOT NULL,
  google_account_subject text,
  google_account_email text,
  calendar_id text NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'active',
  retry_mode boolean NOT NULL DEFAULT false,
  scan_cursor_created_at timestamptz,
  scan_cursor_task_id uuid,
  scan_complete boolean NOT NULL DEFAULT false,
  scan_claim_token uuid,
  scan_lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT calendar_sync_runs_status_check
    CHECK (status IN ('active', 'paused', 'completed', 'failed')),
  CONSTRAINT calendar_sync_runs_cursor_check
    CHECK ((scan_cursor_created_at IS NULL) = (scan_cursor_task_id IS NULL))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS calendar_sync_runs_owner_destination_idx
  ON public.calendar_sync_runs (owner_user_id, destination_key, created_at DESC);
CREATE INDEX IF NOT EXISTS calendar_sync_runs_active_idx
  ON public.calendar_sync_runs (status, updated_at)
  WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS calendar_sync_runs_one_active_destination_unique
  ON public.calendar_sync_runs (owner_user_id, destination_key)
  WHERE status = 'active';
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.calendar_sync_run_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.calendar_sync_runs(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL,
  task_id uuid NOT NULL,
  outcome varchar(24) NOT NULL DEFAULT 'pending',
  exclusion_reason text,
  event_id text,
  payload_hash text,
  error_message text,
  job_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_sync_run_items_outcome_check
    CHECK (outcome IN ('pending', 'created', 'updated', 'removed', 'unchanged', 'excluded', 'failed')),
  CONSTRAINT calendar_sync_run_items_unique UNIQUE (run_id, task_id)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS calendar_sync_run_items_outcome_idx
  ON public.calendar_sync_run_items (run_id, outcome);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.calendar_event_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  task_id uuid NOT NULL,
  destination_key text NOT NULL,
  google_account_subject text,
  google_account_email text,
  calendar_id text NOT NULL,
  event_id text NOT NULL,
  generation integer NOT NULL DEFAULT 1,
  status varchar(16) NOT NULL DEFAULT 'active',
  metadata_verified boolean NOT NULL DEFAULT false,
  payload_hash text,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_event_mappings_status_check
    CHECK (status IN ('active', 'removed')),
  CONSTRAINT calendar_event_mappings_generation_check
    CHECK (generation >= 1),
  CONSTRAINT calendar_event_mappings_destination_unique
    UNIQUE (owner_user_id, task_id, destination_key)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS calendar_event_mappings_destination_idx
  ON public.calendar_event_mappings (destination_key, status);
CREATE INDEX IF NOT EXISTS calendar_event_mappings_task_idx
  ON public.calendar_event_mappings (owner_user_id, task_id);
--> statement-breakpoint

ALTER TABLE public.calendar_sync_jobs
  ADD COLUMN IF NOT EXISTS queue_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES public.calendar_sync_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS destination_key text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS google_account_subject text,
  ADD COLUMN IF NOT EXISTS google_account_email text,
  ADD COLUMN IF NOT EXISTS calendar_id text,
  ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS event_exists boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS payload_hash text,
  ADD COLUMN IF NOT EXISTS outcome varchar(24),
  ADD COLUMN IF NOT EXISTS exclusion_reason text,
  ADD COLUMN IF NOT EXISTS permanent_failure boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS task_updated_at timestamptz;
--> statement-breakpoint

ALTER TABLE public.calendar_sync_jobs
  DROP CONSTRAINT IF EXISTS calendar_sync_jobs_operation_check;
ALTER TABLE public.calendar_sync_jobs
  ADD CONSTRAINT calendar_sync_jobs_operation_check
  CHECK (operation IN ('upsert', 'delete'));
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS calendar_sync_jobs_run_idx
  ON public.calendar_sync_jobs (run_id, status, scheduled_at)
  WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS calendar_sync_jobs_destination_ready_idx
  ON public.calendar_sync_jobs (destination_key, scheduled_at, created_at)
  WHERE queue_version = 2 AND status IN ('pending', 'processing');

-- Legacy claims were not serialized. Keep the newest processing row per task
-- and destination and return the rest to pending before adding the guard.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY owner_user_id, task_id, destination_key
           ORDER BY locked_at DESC NULLS LAST, created_at DESC
         ) AS position
  FROM public.calendar_sync_jobs
  WHERE status = 'processing'
)
UPDATE public.calendar_sync_jobs AS job
SET status = 'pending',
    claim_token = NULL,
    lease_expires_at = NULL,
    locked_at = NULL
FROM ranked
WHERE job.id = ranked.id
  AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS calendar_sync_jobs_one_processing_unique
  ON public.calendar_sync_jobs (owner_user_id, task_id, destination_key)
  WHERE status = 'processing';
CREATE UNIQUE INDEX IF NOT EXISTS calendar_sync_jobs_one_pending_v2_unique
  ON public.calendar_sync_jobs (owner_user_id, task_id, destination_key)
  WHERE status = 'pending' AND queue_version = 2;
--> statement-breakpoint

-- Existing scheduled-sync jobs keep working. Stamp the destination they were
-- created under so a later account/calendar switch cannot silently redirect
-- them, and so the processing uniqueness guard applies across both queue
-- versions.
UPDATE public.calendar_sync_jobs AS j
SET
  destination_key = COALESCE(
    NULLIF(lower(s.google_account_email), ''),
    NULLIF(s.google_account_subject, ''),
    'unknown-account'
  ) || '|' || COALESCE(NULLIF(s.calendar_id, ''), 'primary'),
  google_account_subject = s.google_account_subject,
  google_account_email = s.google_account_email,
  calendar_id = COALESCE(NULLIF(s.calendar_id, ''), 'primary')
FROM public.calendar_integration_settings AS s
WHERE j.owner_user_id = s.owner_user_id
  AND s.provider = 'google'
  AND j.destination_key = '';
--> statement-breakpoint

ALTER TABLE public.calendar_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_sync_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_sync_run_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_sync_run_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_event_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_event_mappings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY calendar_sync_runs_select_own
  ON public.calendar_sync_runs FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());
CREATE POLICY calendar_sync_runs_insert_own
  ON public.calendar_sync_runs FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY calendar_sync_runs_update_own
  ON public.calendar_sync_runs FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY calendar_sync_runs_delete_own
  ON public.calendar_sync_runs FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());
--> statement-breakpoint

CREATE POLICY calendar_sync_run_items_select_own
  ON public.calendar_sync_run_items FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());
CREATE POLICY calendar_sync_run_items_insert_own
  ON public.calendar_sync_run_items FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY calendar_sync_run_items_update_own
  ON public.calendar_sync_run_items FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY calendar_sync_run_items_delete_own
  ON public.calendar_sync_run_items FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());
--> statement-breakpoint

CREATE POLICY calendar_event_mappings_select_own
  ON public.calendar_event_mappings FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());
CREATE POLICY calendar_event_mappings_insert_own
  ON public.calendar_event_mappings FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY calendar_event_mappings_update_own
  ON public.calendar_event_mappings FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY calendar_event_mappings_delete_own
  ON public.calendar_event_mappings FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());
--> statement-breakpoint

-- Claim one scan page. The token and lease make a crashed continuation
-- recoverable without allowing two workers to advance the same cursor.
CREATE OR REPLACE FUNCTION public.calendar_sync_claim_run_scan(
  p_run_id uuid,
  p_claim_token uuid,
  p_now timestamptz,
  p_lease_seconds integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $claim$
DECLARE
  v_updated integer := 0;
BEGIN
  UPDATE public.calendar_sync_runs
  SET scan_claim_token = p_claim_token,
      scan_lease_expires_at = p_now + make_interval(secs => greatest(p_lease_seconds, 30)),
      updated_at = p_now
  WHERE id = p_run_id
    AND status = 'active'
    AND (
      scan_claim_token IS NULL
      OR scan_lease_expires_at IS NULL
      OR scan_lease_expires_at <= p_now
      OR scan_claim_token = p_claim_token
    );
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END
$claim$;
--> statement-breakpoint

-- Commit a scanned task page together with its queued work and cursor. A crash
-- can only replay the page; it cannot skip it.
CREATE OR REPLACE FUNCTION public.calendar_sync_commit_scan_page(
  p_run_id uuid,
  p_claim_token uuid,
  p_next_cursor_created_at timestamptz,
  p_next_cursor_task_id uuid,
  p_scan_complete boolean,
  p_items jsonb,
  p_jobs jsonb,
  p_now timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $commit$
DECLARE
  v_run public.calendar_sync_runs;
BEGIN
  SELECT * INTO v_run
  FROM public.calendar_sync_runs
  WHERE id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_run.status <> 'active' THEN
    RETURN false;
  END IF;
  IF v_run.scan_claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN false;
  END IF;
  IF v_run.scan_lease_expires_at IS NULL OR v_run.scan_lease_expires_at <= p_now THEN
    RETURN false;
  END IF;

  INSERT INTO public.calendar_sync_run_items (
    run_id, owner_user_id, task_id, outcome, exclusion_reason,
    event_id, payload_hash, error_message, updated_at
  )
  SELECT
    p_run_id,
    v_run.owner_user_id,
    (item->>'task_id')::uuid,
    item->>'outcome',
    NULLIF(item->>'exclusion_reason', ''),
    NULLIF(item->>'event_id', ''),
    NULLIF(item->>'payload_hash', ''),
    NULLIF(item->>'error_message', ''),
    p_now
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS item
  ON CONFLICT (run_id, task_id) DO UPDATE
  SET outcome = EXCLUDED.outcome,
      exclusion_reason = EXCLUDED.exclusion_reason,
      event_id = EXCLUDED.event_id,
      payload_hash = EXCLUDED.payload_hash,
      error_message = EXCLUDED.error_message,
      updated_at = p_now;

  INSERT INTO public.calendar_sync_jobs (
    owner_user_id, task_id, calendar_event_id, operation, status, attempts,
    updated_at, queue_version, run_id, destination_key,
    google_account_subject, google_account_email, calendar_id,
    generation, event_exists, payload_hash, exclusion_reason, task_updated_at, scheduled_at
  )
  SELECT
    v_run.owner_user_id,
    (job->>'task_id')::uuid,
    NULL,
    job->>'operation',
    'pending',
    0,
    p_now,
    2,
    p_run_id,
    v_run.destination_key,
    v_run.google_account_subject,
    v_run.google_account_email,
    v_run.calendar_id,
    COALESCE((job->>'generation')::integer, 1),
    COALESCE((job->>'event_exists')::boolean, false),
    NULLIF(job->>'payload_hash', ''),
    NULLIF(job->>'exclusion_reason', ''),
    NULLIF(job->>'task_updated_at', '')::timestamptz,
    p_now
  FROM jsonb_array_elements(COALESCE(p_jobs, '[]'::jsonb)) AS job
  ON CONFLICT (owner_user_id, task_id, destination_key)
    WHERE (status = 'pending' AND queue_version = 2)
  DO UPDATE
  SET operation = EXCLUDED.operation,
      generation = EXCLUDED.generation,
      event_exists = EXCLUDED.event_exists,
      payload_hash = EXCLUDED.payload_hash,
      exclusion_reason = EXCLUDED.exclusion_reason,
      task_updated_at = EXCLUDED.task_updated_at,
      scheduled_at = LEAST(public.calendar_sync_jobs.scheduled_at, p_now),
      last_error = NULL,
      permanent_failure = false,
      updated_at = p_now;

  UPDATE public.calendar_sync_run_items AS item
  SET job_id = job.id
  FROM public.calendar_sync_jobs AS job
  WHERE item.run_id = p_run_id
    AND job.run_id = p_run_id
    AND job.task_id = item.task_id
    AND job.destination_key = v_run.destination_key
    AND job.queue_version = 2
    AND job.status IN ('pending', 'processing');

  UPDATE public.calendar_sync_runs
  SET scan_cursor_created_at = p_next_cursor_created_at,
      scan_cursor_task_id = p_next_cursor_task_id,
      scan_complete = p_scan_complete,
      scan_claim_token = NULL,
      scan_lease_expires_at = NULL,
      updated_at = p_now
  WHERE id = p_run_id;

  RETURN true;
END
$commit$;
--> statement-breakpoint

-- Atomic claim with FOR UPDATE SKIP LOCKED. An expired lease is returned to
-- pending first. A pending job is never claimed while another valid processing
-- lease exists for the same task and destination.
CREATE OR REPLACE FUNCTION public.calendar_sync_claim_jobs(
  p_owner uuid,
  p_destination_key text,
  p_run_id uuid,
  p_claim_token uuid,
  p_limit integer,
  p_now timestamptz,
  p_lease_seconds integer
) RETURNS SETOF public.calendar_sync_jobs
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $claim_jobs$
BEGIN
  UPDATE public.calendar_sync_jobs
  SET status = 'pending',
      claim_token = NULL,
      lease_expires_at = NULL,
      updated_at = p_now
  WHERE status = 'processing'
    AND lease_expires_at IS NOT NULL
    AND lease_expires_at <= p_now
    AND (
      (queue_version = 2 AND (p_run_id IS NULL OR run_id = p_run_id))
      OR (queue_version = 1 AND run_id IS NULL)
    )
    AND (p_owner IS NULL OR owner_user_id = p_owner)
    AND (p_destination_key IS NULL OR destination_key = p_destination_key);

  RETURN QUERY
  WITH candidates AS (
    SELECT job.id
    FROM public.calendar_sync_jobs AS job
    WHERE job.queue_version = 2
      AND job.status = 'pending'
      AND job.scheduled_at <= p_now
      AND job.attempts < 8
      AND job.permanent_failure = false
      AND (p_owner IS NULL OR job.owner_user_id = p_owner)
      AND (p_destination_key IS NULL OR job.destination_key = p_destination_key)
      AND (p_run_id IS NULL OR job.run_id = p_run_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.calendar_sync_jobs AS lease
        WHERE lease.owner_user_id = job.owner_user_id
          AND lease.task_id = job.task_id
          AND lease.destination_key = job.destination_key
          AND lease.status = 'processing'
          AND lease.lease_expires_at IS NOT NULL
          AND lease.lease_expires_at > p_now
      )
    ORDER BY job.scheduled_at, job.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(p_limit, 1)
  )
  UPDATE public.calendar_sync_jobs AS job
  SET status = 'processing',
      claim_token = p_claim_token,
      lease_expires_at = p_now + make_interval(secs => greatest(p_lease_seconds, 30)),
      attempts = job.attempts + 1,
      updated_at = p_now
  FROM candidates
  WHERE job.id = candidates.id
  RETURNING job.*;
END
$claim_jobs$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.calendar_sync_list_orphan_mappings(
  p_owner_user_id uuid,
  p_destination_key text,
  p_limit integer
) RETURNS SETOF public.calendar_event_mappings
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $orphans$
  SELECT mapping.*
  FROM public.calendar_event_mappings AS mapping
  WHERE mapping.status = 'active'
    AND mapping.owner_user_id = p_owner_user_id
    AND mapping.destination_key = p_destination_key
    AND NOT EXISTS (
      SELECT 1
      FROM public.tasks AS task
      WHERE task.id = mapping.task_id
        AND task.owner_user_id = mapping.owner_user_id
    )
  ORDER BY mapping.updated_at
  LIMIT greatest(p_limit, 1);
$orphans$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.calendar_sync_run_counts(
  p_run_id uuid
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $counts$
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM public.calendar_sync_run_items WHERE run_id = p_run_id),
    'created', (SELECT count(*) FROM public.calendar_sync_run_items WHERE run_id = p_run_id AND outcome = 'created'),
    'updated', (SELECT count(*) FROM public.calendar_sync_run_items WHERE run_id = p_run_id AND outcome = 'updated'),
    'removed', (SELECT count(*) FROM public.calendar_sync_run_items WHERE run_id = p_run_id AND outcome = 'removed'),
    'unchanged', (SELECT count(*) FROM public.calendar_sync_run_items WHERE run_id = p_run_id AND outcome = 'unchanged'),
    'excluded', (SELECT count(*) FROM public.calendar_sync_run_items WHERE run_id = p_run_id AND outcome = 'excluded'),
    'failed', (SELECT count(*) FROM public.calendar_sync_run_items WHERE run_id = p_run_id AND outcome = 'failed'),
    'pending', (
      SELECT count(*) FROM public.calendar_sync_jobs
      WHERE run_id = p_run_id
        AND (status = 'processing' OR (status = 'pending' AND scheduled_at <= now()))
    ),
    'processing', (SELECT count(*) FROM public.calendar_sync_jobs WHERE run_id = p_run_id AND status = 'processing'),
    'ready', (
      SELECT count(*) FROM public.calendar_sync_jobs
      WHERE run_id = p_run_id
        AND (status = 'processing' OR (status = 'pending' AND scheduled_at <= now()))
    ),
    'retrying', (
      SELECT count(*) FROM public.calendar_sync_jobs
      WHERE run_id = p_run_id AND status = 'pending' AND attempts > 0 AND scheduled_at > now()
    )
  );
$counts$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.calendar_sync_run_exclusions(
  p_run_id uuid
) RETURNS TABLE(reason text, count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $exclusions$
  SELECT exclusion_reason AS reason, count(*) AS count
  FROM public.calendar_sync_run_items
  WHERE run_id = p_run_id AND exclusion_reason IS NOT NULL
  GROUP BY exclusion_reason
  ORDER BY count(*) DESC, exclusion_reason;
$exclusions$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.calendar_sync_run_failures(
  p_run_id uuid,
  p_limit integer
) RETURNS TABLE(task_id uuid, message text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $failures$
  SELECT item.task_id, item.error_message AS message
  FROM public.calendar_sync_run_items AS item
  WHERE item.run_id = p_run_id
    AND item.outcome = 'failed'
    AND item.error_message IS NOT NULL
  ORDER BY item.updated_at DESC
  LIMIT greatest(p_limit, 1);
$failures$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.calendar_sync_upsert_mapping(
  p_owner_user_id uuid,
  p_task_id uuid,
  p_destination_key text,
  p_google_account_subject text,
  p_google_account_email text,
  p_calendar_id text,
  p_event_id text,
  p_generation integer,
  p_payload_hash text,
  p_now timestamptz
) RETURNS SETOF public.calendar_event_mappings
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $upsert_mapping$
DECLARE
  v_owner uuid := COALESCE(p_owner_user_id, auth.uid());
BEGIN
  IF auth.uid() IS NOT NULL AND v_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Calendar mapping owner mismatch' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  INSERT INTO public.calendar_event_mappings (
    owner_user_id, task_id, destination_key, google_account_subject,
    google_account_email, calendar_id, event_id, generation, status,
    metadata_verified, payload_hash, last_synced_at, updated_at
  )
  VALUES (
    v_owner, p_task_id, p_destination_key, p_google_account_subject,
    p_google_account_email, p_calendar_id, p_event_id, greatest(p_generation, 1),
    'active', true, p_payload_hash, p_now, p_now
  )
  ON CONFLICT (owner_user_id, task_id, destination_key) DO UPDATE
  SET event_id = EXCLUDED.event_id,
      generation = EXCLUDED.generation,
      google_account_subject = EXCLUDED.google_account_subject,
      google_account_email = EXCLUDED.google_account_email,
      calendar_id = EXCLUDED.calendar_id,
      status = 'active',
      metadata_verified = true,
      payload_hash = EXCLUDED.payload_hash,
      last_synced_at = p_now,
      updated_at = p_now
  WHERE public.calendar_event_mappings.generation <= EXCLUDED.generation
  RETURNING *;
END
$upsert_mapping$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.calendar_sync_claim_run_scan(uuid, uuid, timestamptz, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calendar_sync_commit_scan_page(uuid, uuid, timestamptz, uuid, boolean, jsonb, jsonb, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calendar_sync_claim_jobs(uuid, text, uuid, uuid, integer, timestamptz, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calendar_sync_list_orphan_mappings(uuid, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calendar_sync_run_counts(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calendar_sync_run_exclusions(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calendar_sync_run_failures(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calendar_sync_upsert_mapping(uuid, uuid, text, text, text, text, text, integer, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_sync_claim_run_scan(uuid, uuid, timestamptz, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calendar_sync_commit_scan_page(uuid, uuid, timestamptz, uuid, boolean, jsonb, jsonb, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calendar_sync_claim_jobs(uuid, text, uuid, uuid, integer, timestamptz, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calendar_sync_list_orphan_mappings(uuid, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calendar_sync_run_counts(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calendar_sync_run_exclusions(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calendar_sync_run_failures(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calendar_sync_upsert_mapping(uuid, uuid, text, text, text, text, text, integer, text, timestamptz) TO authenticated, service_role;

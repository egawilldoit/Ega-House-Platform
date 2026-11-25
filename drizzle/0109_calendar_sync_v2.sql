-- Calendar sync v2: resumable manual sync, destination-bound mappings and a
-- durable coalesced queue.
--
-- Compatibility notes:
-- * Existing calendar_integration_settings rows keep their tokens and calendar.
-- * Existing calendar_sync_jobs rows stay queue_version = 1 and are still
--   processed by the legacy scheduled-sync drain.
-- * tasks.calendar_event_id is preserved, but adopted only when the current
--   destination positively proves it belongs to this task.
-- * Legacy jobs whose original destination cannot be established stay
--   unstamped and are rejected before any Google request. A calendar switch
--   on the same connection cannot be distinguished from the current calendar,
--   so those jobs stay unbound too.
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
  next_retry_at timestamptz,
  listing_revision integer NOT NULL DEFAULT 0,
  listing_next_page_token text,
  listing_events jsonb,
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
CREATE INDEX IF NOT EXISTS calendar_sync_run_items_job_idx
  ON public.calendar_sync_run_items (job_id)
  WHERE job_id IS NOT NULL;
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

-- Stamp a legacy scheduled-sync job only when the owner's settings prove both
-- the original account AND the original calendar. `connected_at` changes on
-- connect/reconnect, but `calendar_id` can be changed without reconnecting, so
-- account identity alone is not evidence of the calendar a job was queued for.
-- `updated_at` is advanced by every settings write (connect, reconnect and
-- calendar change), so requiring it to be at or before the job's creation is a
-- conservative proof that neither the account nor the calendar changed after
-- the job was queued. Any settings change after queuing (including a calendar
-- switch on the same connection) leaves the job unstamped: the legacy
-- scheduled-sync worker rejects unstamped jobs before any Google request and
-- the v2 recovery path never claims them. Jobs that already carry a
-- destination are preserved untouched.
UPDATE public.calendar_sync_jobs AS j
SET
  destination_key =
    COALESCE(
      NULLIF(trim(s.google_account_subject), ''),
      NULLIF(lower(trim(s.google_account_email)), ''),
      'unknown-account'
    ) || '|' || COALESCE(NULLIF(trim(s.calendar_id), ''), 'primary'),
  google_account_subject = s.google_account_subject,
  google_account_email = s.google_account_email,
  calendar_id = COALESCE(NULLIF(trim(s.calendar_id), ''), 'primary')
FROM public.calendar_integration_settings AS s
WHERE j.owner_user_id = s.owner_user_id
  AND s.provider = 'google'
  AND j.destination_key = ''
  AND s.connected_at IS NOT NULL
  AND s.connected_at <= j.created_at
  AND s.updated_at IS NOT NULL
  AND s.updated_at <= j.created_at
  AND (
    NULLIF(lower(trim(s.google_account_email)), '') IS NOT NULL
    OR NULLIF(trim(s.google_account_subject), '') IS NOT NULL
  );
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
  USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY calendar_sync_runs_insert_own
  ON public.calendar_sync_runs FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY calendar_sync_runs_update_own
  ON public.calendar_sync_runs FOR UPDATE TO authenticated
  USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL)
  WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY calendar_sync_runs_delete_own
  ON public.calendar_sync_runs FOR DELETE TO authenticated
  USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
--> statement-breakpoint

CREATE POLICY calendar_sync_run_items_select_own
  ON public.calendar_sync_run_items FOR SELECT TO authenticated
  USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY calendar_sync_run_items_insert_own
  ON public.calendar_sync_run_items FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY calendar_sync_run_items_update_own
  ON public.calendar_sync_run_items FOR UPDATE TO authenticated
  USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL)
  WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY calendar_sync_run_items_delete_own
  ON public.calendar_sync_run_items FOR DELETE TO authenticated
  USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
--> statement-breakpoint

CREATE POLICY calendar_event_mappings_select_own
  ON public.calendar_event_mappings FOR SELECT TO authenticated
  USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY calendar_event_mappings_insert_own
  ON public.calendar_event_mappings FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY calendar_event_mappings_update_own
  ON public.calendar_event_mappings FOR UPDATE TO authenticated
  USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL)
  WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY calendar_event_mappings_delete_own
  ON public.calendar_event_mappings FOR DELETE TO authenticated
  USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
--> statement-breakpoint

-- Claim one scan page. The token and lease make a crashed continuation
-- recoverable without allowing two workers to advance the same cursor.
CREATE OR REPLACE FUNCTION public.calendar_sync_claim_run_scan(
  p_run_id uuid,
  p_claim_token uuid,
  p_now timestamptz,
  p_lease_seconds integer
) RETURNS SETOF public.calendar_sync_runs
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $claim$
  UPDATE public.calendar_sync_runs
  SET scan_claim_token = p_claim_token,
      scan_lease_expires_at = clock_timestamp() + make_interval(secs => greatest(p_lease_seconds, 30)),
      updated_at = p_now
  WHERE id = p_run_id
    AND status = 'active'
    AND NOT scan_complete
    AND (next_retry_at IS NULL OR next_retry_at <= clock_timestamp())
    AND (
      scan_claim_token IS NULL
      OR scan_lease_expires_at IS NULL
      OR scan_lease_expires_at <= clock_timestamp()
      OR scan_claim_token = p_claim_token
    )
  RETURNING *;
$claim$;
--> statement-breakpoint

-- Commit a scanned task page together with its queued work and cursor. A crash
-- can only replay the page; it cannot skip it. Queued work keeps the planned
-- calendar event id so a claimed update or delete targets the mapped event
-- instead of creating a duplicate.
CREATE OR REPLACE FUNCTION public.calendar_sync_commit_scan_page(
  p_run_id uuid,
  p_claim_token uuid,
  p_next_cursor_created_at timestamptz,
  p_next_cursor_task_id uuid,
  p_scan_complete boolean,
  p_items jsonb,
  p_jobs jsonb,
  p_now timestamptz,
  p_expected_cursor_created_at timestamptz DEFAULT NULL,
  p_expected_cursor_task_id uuid DEFAULT NULL,
  p_retry_at timestamptz DEFAULT NULL
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
  IF v_run.scan_complete
    OR v_run.scan_lease_expires_at IS NULL
    OR v_run.scan_lease_expires_at <= clock_timestamp()
    OR v_run.scan_cursor_created_at IS DISTINCT FROM p_expected_cursor_created_at
    OR v_run.scan_cursor_task_id IS DISTINCT FROM p_expected_cursor_task_id THEN
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
    NULLIF(job->>'calendar_event_id', ''),
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
    LEAST(p_now, now())
  FROM jsonb_array_elements(COALESCE(p_jobs, '[]'::jsonb)) AS job
  ON CONFLICT (owner_user_id, task_id, destination_key)
    WHERE (status = 'pending' AND queue_version = 2)
  DO UPDATE
  SET operation = EXCLUDED.operation,
      run_id = EXCLUDED.run_id,
      attempts = 0,
      calendar_event_id = CASE
        WHEN calendar_sync_jobs.generation > EXCLUDED.generation
          AND calendar_sync_jobs.calendar_event_id IS NOT NULL
          THEN calendar_sync_jobs.calendar_event_id
        ELSE COALESCE(EXCLUDED.calendar_event_id, calendar_sync_jobs.calendar_event_id)
      END,
      generation = CASE
        WHEN calendar_sync_jobs.calendar_event_id IS NOT NULL
          THEN greatest(calendar_sync_jobs.generation, EXCLUDED.generation)
        ELSE EXCLUDED.generation
      END,
      event_exists = EXCLUDED.event_exists AND calendar_sync_jobs.generation <= EXCLUDED.generation,
      payload_hash = EXCLUDED.payload_hash,
      exclusion_reason = EXCLUDED.exclusion_reason,
      task_updated_at = EXCLUDED.task_updated_at,
      last_error = NULL,
      permanent_failure = false,
      updated_at = p_now;

  UPDATE public.calendar_sync_run_items AS item
  SET job_id = job.id
  FROM public.calendar_sync_jobs AS job
  WHERE item.run_id = p_run_id
    AND item.outcome = 'pending'
    AND job.run_id = p_run_id
    AND job.task_id = item.task_id
    AND job.destination_key = v_run.destination_key
    AND job.queue_version = 2
    AND job.status = 'pending';

  UPDATE public.calendar_sync_runs
  SET scan_cursor_created_at = p_next_cursor_created_at,
      scan_cursor_task_id = p_next_cursor_task_id,
      scan_complete = p_scan_complete,
      listing_events = CASE WHEN p_scan_complete THEN NULL ELSE listing_events END,
      scan_claim_token = NULL,
      scan_lease_expires_at = NULL,
      next_retry_at = p_retry_at,
      updated_at = p_now
  WHERE id = p_run_id;

  RETURN true;
END
$commit$;
--> statement-breakpoint

-- Atomic claim with FOR UPDATE SKIP LOCKED. An expired lease is returned to
-- pending first. A pending job is never claimed while another valid processing
-- lease exists for the same task and destination.
--
-- An expired v2 processing row may have a newer pending edit for the same task
-- and destination: a scan-page commit cannot coalesce into a processing row, so
-- it inserts a pending row. The one-pending guard means the processing row
-- cannot simply be demoted. Delete and re-insert it into the pending slot so a
-- concurrent commit coalesces through ON CONFLICT instead of raising a unique
-- violation. When a pending row already exists it keeps the latest intent; the
-- expired row's event identity is retained when it has a newer generation
-- or supplies the missing id for the same generation. An ambiguous write may
-- already have used that id. The expired row id
-- disappears, so its claim token can no longer finalize the newer work.
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
  -- Legacy v1 claims predate the pending guard, so they can return in place.
  UPDATE public.calendar_sync_jobs
  SET status = 'pending',
      claim_token = NULL,
      lease_expires_at = NULL,
      updated_at = p_now
  WHERE status = 'processing'
    AND queue_version = 1
    AND run_id IS NULL
    AND lease_expires_at IS NOT NULL
    AND lease_expires_at <= clock_timestamp()
    AND (p_owner IS NULL OR owner_user_id = p_owner)
    AND (p_destination_key IS NULL OR destination_key = p_destination_key);

  WITH expired AS (
    DELETE FROM public.calendar_sync_jobs AS job
    WHERE job.status = 'processing'
      AND job.queue_version = 2
      AND job.lease_expires_at IS NOT NULL
      AND job.lease_expires_at <= clock_timestamp()
      AND (
        job.run_id IS NOT DISTINCT FROM p_run_id
        OR EXISTS (
          SELECT 1 FROM public.calendar_sync_jobs AS pending
          WHERE pending.owner_user_id = job.owner_user_id
            AND pending.task_id = job.task_id
            AND pending.destination_key = job.destination_key
            AND pending.queue_version = 2 AND pending.status = 'pending'
            AND pending.run_id IS NOT DISTINCT FROM p_run_id
        )
      )
      AND (p_owner IS NULL OR job.owner_user_id = p_owner)
      AND (p_destination_key IS NULL OR job.destination_key = p_destination_key)
    RETURNING job.*
  ),
  merged AS (
    INSERT INTO public.calendar_sync_jobs (
      id, owner_user_id, task_id, calendar_event_id, operation, status, attempts,
      last_error, locked_at, created_at, updated_at, queue_version, run_id,
      destination_key, google_account_subject, google_account_email, calendar_id,
      generation, event_exists, claim_token, lease_expires_at, scheduled_at,
      payload_hash, outcome, exclusion_reason, permanent_failure, task_updated_at
    )
    SELECT
      expired.id, expired.owner_user_id, expired.task_id,
      expired.calendar_event_id, expired.operation, 'pending', least(expired.attempts, 7),
      expired.last_error, NULL, expired.created_at, p_now, expired.queue_version,
      expired.run_id, expired.destination_key, expired.google_account_subject,
      expired.google_account_email, expired.calendar_id, expired.generation,
      expired.event_exists, NULL, NULL, expired.scheduled_at,
      expired.payload_hash, expired.outcome, expired.exclusion_reason,
      expired.permanent_failure, expired.task_updated_at
    FROM expired
    ON CONFLICT (owner_user_id, task_id, destination_key)
      WHERE (status = 'pending' AND queue_version = 2)
    DO UPDATE
    SET calendar_event_id = CASE
        WHEN EXCLUDED.generation > calendar_sync_jobs.generation AND EXCLUDED.calendar_event_id IS NOT NULL
          THEN EXCLUDED.calendar_event_id
        WHEN EXCLUDED.generation = calendar_sync_jobs.generation
          THEN COALESCE(calendar_sync_jobs.calendar_event_id, EXCLUDED.calendar_event_id)
        ELSE calendar_sync_jobs.calendar_event_id
      END,
      generation = CASE
        WHEN EXCLUDED.calendar_event_id IS NOT NULL
          THEN greatest(calendar_sync_jobs.generation, EXCLUDED.generation)
        ELSE calendar_sync_jobs.generation
      END,
      run_id = COALESCE(calendar_sync_jobs.run_id, EXCLUDED.run_id),
      event_exists = calendar_sync_jobs.event_exists AND NOT (
        EXCLUDED.generation > calendar_sync_jobs.generation AND EXCLUDED.calendar_event_id IS NOT NULL
      ),
      updated_at = p_now
    RETURNING *
  )
  UPDATE public.calendar_sync_run_items AS item
  SET job_id = merged.id
  FROM expired, merged
  WHERE item.job_id = expired.id
    AND merged.owner_user_id = expired.owner_user_id
    AND merged.task_id = expired.task_id
    AND merged.destination_key = expired.destination_key;

  RETURN QUERY
  WITH candidates AS (
    SELECT job.id
    FROM public.calendar_sync_jobs AS job
    WHERE job.queue_version = 2
      AND job.status = 'pending'
      AND job.scheduled_at <= clock_timestamp()
      AND job.attempts < 8
      AND job.permanent_failure = false
      AND (p_owner IS NULL OR job.owner_user_id = p_owner)
      AND (p_destination_key IS NULL OR job.destination_key = p_destination_key)
      AND job.run_id IS NOT DISTINCT FROM p_run_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.calendar_sync_jobs AS lease
        WHERE lease.owner_user_id = job.owner_user_id
          AND lease.task_id = job.task_id
          AND lease.destination_key = job.destination_key
          AND lease.status = 'processing'
          AND lease.lease_expires_at IS NOT NULL
          AND lease.lease_expires_at > clock_timestamp()
      )
    ORDER BY job.scheduled_at, job.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(p_limit, 1)
  )
  UPDATE public.calendar_sync_jobs AS job
  SET status = 'processing',
      claim_token = p_claim_token,
      lease_expires_at = clock_timestamp() + make_interval(secs => greatest(p_lease_seconds, 30)),
      attempts = job.attempts + 1,
      updated_at = p_now
  FROM candidates
  WHERE job.id = candidates.id
  RETURNING job.*;
END
$claim_jobs$;
--> statement-breakpoint

-- Return claimed work to the coalesced pending slot. A claim can fail or be
-- released after a scan-page commit created a newer pending edit for the same
-- task and destination; demoting the processing row in place would violate the
-- one-pending guard. The newer intent wins, the processing row is removed so
-- its token cannot finalize newer work, and the same-generation event id is
-- kept because an ambiguous write may have used it. Rows without a competing
-- pending edit are returned to pending with an optional failure settlement and
-- returned to the caller, so a retry that was superseded reports no outcome.
CREATE OR REPLACE FUNCTION public.calendar_sync_release_claimed_jobs(
  p_job_ids uuid[],
  p_claim_token uuid,
  p_now timestamptz,
  p_record_failure boolean,
  p_last_error text,
  p_outcome varchar,
  p_exclusion_reason text,
  p_scheduled_at timestamptz
) RETURNS SETOF public.calendar_sync_jobs
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $release_jobs$
DECLARE
  v_job_id uuid;
  v_job public.calendar_sync_jobs;
BEGIN
  IF p_claim_token IS NULL OR p_job_ids IS NULL THEN
    RETURN;
  END IF;

  FOREACH v_job_id IN ARRAY p_job_ids LOOP
    SELECT job.* INTO v_job
    FROM public.calendar_sync_jobs AS job
    WHERE job.id = v_job_id
      AND job.status = 'processing'
      AND job.claim_token = p_claim_token
      AND job.lease_expires_at > clock_timestamp()
    FOR UPDATE;

    CONTINUE WHEN NOT FOUND;

    WITH expired AS (
      DELETE FROM public.calendar_sync_jobs AS job
      WHERE job.id = v_job.id
      RETURNING job.*
    ),
    merged AS (
      INSERT INTO public.calendar_sync_jobs (
        id, owner_user_id, task_id, calendar_event_id, operation, status, attempts,
        last_error, locked_at, created_at, updated_at, queue_version, run_id,
        destination_key, google_account_subject, google_account_email, calendar_id,
        generation, event_exists, claim_token, lease_expires_at, scheduled_at,
        payload_hash, outcome, exclusion_reason, permanent_failure, task_updated_at
      )
      SELECT
        expired.id, expired.owner_user_id, expired.task_id,
        expired.calendar_event_id, expired.operation, 'pending',
        CASE WHEN p_record_failure THEN expired.attempts ELSE greatest(expired.attempts - 1, 0) END,
        CASE WHEN p_record_failure THEN p_last_error ELSE expired.last_error END,
        NULL, expired.created_at, p_now, expired.queue_version,
        expired.run_id, expired.destination_key, expired.google_account_subject,
        expired.google_account_email, expired.calendar_id, expired.generation,
        expired.event_exists, NULL, NULL,
        CASE
          WHEN p_record_failure THEN COALESCE(p_scheduled_at, p_now)
          ELSE expired.scheduled_at
        END,
        expired.payload_hash,
        CASE WHEN p_record_failure THEN p_outcome ELSE expired.outcome END,
        CASE
          WHEN p_record_failure THEN p_exclusion_reason
          ELSE expired.exclusion_reason
        END,
        CASE WHEN p_record_failure THEN false ELSE expired.permanent_failure END,
        expired.task_updated_at
      FROM expired
      ON CONFLICT (owner_user_id, task_id, destination_key)
        WHERE (status = 'pending' AND queue_version = 2)
      DO UPDATE
      SET calendar_event_id = CASE
          WHEN EXCLUDED.generation > calendar_sync_jobs.generation AND EXCLUDED.calendar_event_id IS NOT NULL
            THEN EXCLUDED.calendar_event_id
          WHEN EXCLUDED.generation = calendar_sync_jobs.generation
            THEN COALESCE(calendar_sync_jobs.calendar_event_id, EXCLUDED.calendar_event_id)
          ELSE calendar_sync_jobs.calendar_event_id
        END,
        generation = CASE
          WHEN EXCLUDED.calendar_event_id IS NOT NULL
            THEN greatest(calendar_sync_jobs.generation, EXCLUDED.generation)
          ELSE calendar_sync_jobs.generation
        END,
        run_id = COALESCE(calendar_sync_jobs.run_id, EXCLUDED.run_id),
        event_exists = calendar_sync_jobs.event_exists AND NOT (
          EXCLUDED.generation > calendar_sync_jobs.generation AND EXCLUDED.calendar_event_id IS NOT NULL
        ),
        scheduled_at = CASE WHEN p_record_failure
          THEN greatest(calendar_sync_jobs.scheduled_at, EXCLUDED.scheduled_at)
          ELSE calendar_sync_jobs.scheduled_at END,
        updated_at = p_now
      RETURNING *
    )
    UPDATE public.calendar_sync_run_items AS item
    SET job_id = merged.id
    FROM expired, merged
    WHERE item.job_id = expired.id
      AND merged.owner_user_id = expired.owner_user_id
      AND merged.task_id = expired.task_id
      AND merged.destination_key = expired.destination_key;

    -- If the row still exists under its own id, it was requeued in place and
    -- owns its failure settlement. A conflicting newer pending row deletes the
    -- old id, so it is reported as superseded instead.
    SELECT job.* INTO v_job
    FROM public.calendar_sync_jobs AS job
    WHERE job.id = v_job_id
      AND job.status = 'pending';

    IF FOUND THEN
      IF p_record_failure THEN
        UPDATE public.calendar_sync_run_items AS item
        SET outcome = 'pending', exclusion_reason = p_exclusion_reason,
            error_message = NULL, updated_at = p_now
        WHERE item.job_id = v_job.id AND item.run_id = v_job.run_id
          AND item.task_id = v_job.task_id;
        UPDATE public.tasks AS task
        SET calendar_sync_status = 'pending', calendar_sync_failure_reason = p_last_error
        WHERE task.id = v_job.task_id AND task.owner_user_id = v_job.owner_user_id
    AND (task.updated_at = v_job.task_updated_at OR
         (v_job.task_updated_at IS NULL AND task.updated_at <= v_job.created_at));
      END IF;
      RETURN NEXT v_job;
    END IF;
  END LOOP;

  RETURN;
END
$release_jobs$;
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
    -- A mapping is retired only after its delete job settles. Until then the
    -- queued work is the durable marker, so this listing does not enqueue a
    -- duplicate or loop forever on the same still-active mapping.
    AND NOT EXISTS (
      SELECT 1
      FROM public.calendar_sync_jobs AS job
      WHERE job.owner_user_id = mapping.owner_user_id
        AND job.task_id = mapping.task_id
        AND job.destination_key = mapping.destination_key
        AND job.queue_version = 2
        AND job.status IN ('pending', 'processing')
    )
  ORDER BY mapping.updated_at
  LIMIT greatest(p_limit, 1);
$orphans$;
--> statement-breakpoint

-- Finalize a successfully processed job under its active claim token. The job,
-- the provider-confirmed mapping removal (scoped to the exact event id and
-- generation) and the run item outcome settle in one transaction. A stale claim
-- token returns false without touching any of them, so a retry after a provider
-- success and a failed local settlement can safely delete the already-removed
-- event again and retry the same settlement. A newer mapping generation is
-- never retired by an older delete that finishes late.
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
    OR v_job.claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN false;
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

CREATE OR REPLACE FUNCTION public.calendar_sync_run_counts(
  p_run_id uuid
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $counts$
  WITH job_state AS (
    SELECT task_id,
      bool_or(status = 'processing') AS processing,
      bool_or(
        (status = 'pending' AND scheduled_at <= now())
        OR (status = 'processing' AND (lease_expires_at IS NULL OR lease_expires_at <= now()))
      ) AS ready
    FROM public.calendar_sync_jobs
    WHERE run_id = p_run_id AND status IN ('pending', 'processing')
    GROUP BY task_id
  )
  SELECT jsonb_build_object(
    'total', count(*),
    'created', count(*) FILTER (WHERE outcome = 'created'),
    'updated', count(*) FILTER (WHERE outcome = 'updated'),
    'removed', count(*) FILTER (WHERE outcome = 'removed'),
    'unchanged', count(*) FILTER (WHERE outcome = 'unchanged'),
    'excluded', count(*) FILTER (WHERE outcome = 'excluded'),
    'failed', count(*) FILTER (WHERE outcome = 'failed'),
    'pending', count(*) FILTER (WHERE outcome = 'pending' AND ready IS DISTINCT FROM false),
    'processing', count(*) FILTER (WHERE processing),
    'ready', count(*) FILTER (WHERE ready),
    'retrying', count(*) FILTER (WHERE outcome = 'pending' AND NOT ready AND NOT processing)
  )
  FROM public.calendar_sync_run_items AS item
  LEFT JOIN job_state USING (task_id)
  WHERE item.run_id = p_run_id;
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
REVOKE ALL ON FUNCTION public.calendar_sync_commit_scan_page(uuid, uuid, timestamptz, uuid, boolean, jsonb, jsonb, timestamptz, timestamptz, uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calendar_sync_claim_jobs(uuid, text, uuid, uuid, integer, timestamptz, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calendar_sync_release_claimed_jobs(uuid[], uuid, timestamptz, boolean, text, varchar, text, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calendar_sync_complete_job(uuid, uuid, varchar, text, integer, text, text, text, boolean, boolean, text, integer, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calendar_sync_list_orphan_mappings(uuid, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calendar_sync_run_counts(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calendar_sync_run_exclusions(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calendar_sync_run_failures(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calendar_sync_upsert_mapping(uuid, uuid, text, text, text, text, text, integer, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_sync_claim_run_scan(uuid, uuid, timestamptz, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calendar_sync_commit_scan_page(uuid, uuid, timestamptz, uuid, boolean, jsonb, jsonb, timestamptz, timestamptz, uuid, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calendar_sync_claim_jobs(uuid, text, uuid, uuid, integer, timestamptz, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calendar_sync_release_claimed_jobs(uuid[], uuid, timestamptz, boolean, text, varchar, text, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calendar_sync_complete_job(uuid, uuid, varchar, text, integer, text, text, text, boolean, boolean, text, integer, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calendar_sync_list_orphan_mappings(uuid, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calendar_sync_run_counts(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calendar_sync_run_exclusions(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calendar_sync_run_failures(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calendar_sync_upsert_mapping(uuid, uuid, text, text, text, text, text, integer, text, timestamptz) TO authenticated, service_role;

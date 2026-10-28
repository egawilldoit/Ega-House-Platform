-- Actor attribution and producer coverage for the task activity ledger
-- (EGA-784 stage 2).
--
-- Stage 1 recorded field changes with a SECURITY DEFINER trigger but could only
-- distinguish "authenticated owner" from "service role" writes. This migration
-- completes the provenance model:
--
--   * verified owner session            -> actor_kind 'owner'
--   * verified MCP OAuth session        -> actor_kind 'agent', stable
--     actor_agent_id = JWT client_id, label snapshotted from the grant
--   * trusted service-role agent API    -> actor_kind 'agent' from the
--     server-set request headers (x-ega-actor-*), never from a product body
--   * jobs / legacy service writes      -> actor_kind 'system'
--   * rows without trustworthy proof    -> actor_kind 'unknown'
--
-- Actor labels are snapshotted at write time, so credential rotation or
-- revocation cannot rewrite history. The table stays append-only for product
-- clients: only SELECT is granted, and direct INSERT/UPDATE/DELETE are denied.
--
-- Status/timer ledgers gain the same columns (additive; existing analytics
-- consumers are unchanged), and reminders now emit activity. Comments are not
-- stored by this issue; EGA-783 writes `comment` rows through this contract.

--> statement-breakpoint
ALTER TABLE public.task_activity_events
  ADD COLUMN IF NOT EXISTS actor_agent_id text;
ALTER TABLE public.task_activity_events
  ADD COLUMN IF NOT EXISTS source_event_id varchar(128);

ALTER TABLE public.task_status_events
  ADD COLUMN IF NOT EXISTS actor_kind varchar(16) NOT NULL DEFAULT 'unknown';
ALTER TABLE public.task_status_events
  ADD COLUMN IF NOT EXISTS actor_user_id uuid;
ALTER TABLE public.task_status_events
  ADD COLUMN IF NOT EXISTS actor_agent_id text;
ALTER TABLE public.task_status_events
  ADD COLUMN IF NOT EXISTS actor_label text;

ALTER TABLE public.task_sessions
  ADD COLUMN IF NOT EXISTS actor_kind varchar(16) NOT NULL DEFAULT 'unknown';
ALTER TABLE public.task_sessions
  ADD COLUMN IF NOT EXISTS actor_user_id uuid;
ALTER TABLE public.task_sessions
  ADD COLUMN IF NOT EXISTS actor_agent_id text;
ALTER TABLE public.task_sessions
  ADD COLUMN IF NOT EXISTS actor_label text;
--> statement-breakpoint
ALTER TABLE public.task_activity_events
  DROP CONSTRAINT IF EXISTS task_activity_events_event_kind_check;
ALTER TABLE public.task_activity_events
  ADD CONSTRAINT task_activity_events_event_kind_check
  CHECK (
    event_kind IN (
      'created', 'field_change', 'archived', 'restored',
      'reminder_scheduled', 'reminder_updated', 'reminder_cancelled',
      'comment'
    )
  );
--> statement-breakpoint
ALTER TABLE public.task_activity_events
  DROP CONSTRAINT IF EXISTS task_activity_events_actor_kind_check;
ALTER TABLE public.task_activity_events
  ADD CONSTRAINT task_activity_events_actor_kind_check
  CHECK (actor_kind IN ('owner', 'agent', 'system', 'unknown'));
--> statement-breakpoint
ALTER TABLE public.task_status_events
  DROP CONSTRAINT IF EXISTS task_status_events_actor_kind_check;
ALTER TABLE public.task_status_events
  ADD CONSTRAINT task_status_events_actor_kind_check
  CHECK (actor_kind IN ('owner', 'agent', 'system', 'unknown'));
--> statement-breakpoint
ALTER TABLE public.task_sessions
  DROP CONSTRAINT IF EXISTS task_sessions_actor_kind_check;
ALTER TABLE public.task_sessions
  ADD CONSTRAINT task_sessions_actor_kind_check
  CHECK (actor_kind IN ('owner', 'agent', 'system', 'unknown'));
--> statement-breakpoint
-- Stable producer identity for idempotent appends (comments via EGA-783).
-- A retried producer insert with the same source id is rejected instead of
-- producing a second activity row.
CREATE UNIQUE INDEX IF NOT EXISTS task_activity_events_source_unique
  ON public.task_activity_events (owner_user_id, event_kind, source_event_id)
  WHERE source_event_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS task_status_events_actor_idx
  ON public.task_status_events (owner_user_id, actor_kind);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS task_sessions_actor_idx
  ON public.task_sessions (owner_user_id, actor_kind);
--> statement-breakpoint
-- One canonical actor resolver for every task-related trigger. Provenance is
-- read from verified request state only:
--   * auth.uid() / auth.jwt() are set by PostgREST from the verified JWT;
--   * request headers are trusted only for a service-role request, which a
--     product client's authenticated JWT can never be;
--   * everything else is `system`, never an invented identity.
CREATE OR REPLACE FUNCTION public.ega_task_actor()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_claims jsonb := COALESCE((SELECT auth.jwt()), '{}'::jsonb);
  v_client_id text := NULLIF(btrim(v_claims ->> 'client_id'), '');
  v_role text := NULLIF(btrim(v_claims ->> 'role'), '');
  v_headers_text text;
  v_headers jsonb;
  v_header_kind text;
  v_header_agent text;
  v_header_label text;
  v_client_label text;
BEGIN
  IF v_uid IS NOT NULL THEN
    -- MCP OAuth sessions carry a verified client_id claim. The stable identity
    -- is the OAuth client, not the rotating access token.
    IF v_client_id IS NOT NULL THEN
      SELECT NULLIF(
               left(regexp_replace(btrim(grant_record.client_name), '[[:cntrl:]]', '', 'g'), 128),
               ''
             )
        INTO v_client_label
      FROM public.mcp_authorization_grants AS grant_record
      WHERE grant_record.owner_user_id = v_uid
        AND grant_record.oauth_client_id = v_client_id
      ORDER BY grant_record.created_at DESC, grant_record.id DESC
      LIMIT 1;

      RETURN jsonb_build_object(
        'actor_kind', 'agent',
        'actor_user_id', v_uid,
        'actor_agent_id', left(v_client_id, 256),
        'actor_label', COALESCE(v_client_label, left(v_client_id, 128))
      );
    END IF;

    RETURN jsonb_build_object(
      'actor_kind', 'owner',
      'actor_user_id', v_uid,
      'actor_agent_id', NULL,
      'actor_label', NULL
    );
  END IF;

  -- Trusted service-role transport: the scoped agent API verifies its bearer
  -- token server-side, then sets these headers on its own Supabase client. A
  -- product client has role 'authenticated'/'anon', so its headers are ignored.
  IF v_role = 'service_role' THEN
    v_headers_text := NULLIF(current_setting('request.headers', true), '');
    IF v_headers_text IS NOT NULL THEN
      v_headers := v_headers_text::jsonb;
      v_header_kind := NULLIF(btrim(v_headers ->> 'x-ega-actor-kind'), '');
      IF v_header_kind = 'agent' THEN
        v_header_agent := NULLIF(btrim(v_headers ->> 'x-ega-actor-agent-id'), '');
        IF v_header_agent IS NOT NULL
          AND v_header_agent ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN
          -- The label is snapshotted from the token row at write time. The
          -- header never carries presentation text, and a deleted token still
          -- leaves the stable id on historical rows.
          SELECT NULLIF(
                   left(regexp_replace(btrim(token_record.name), '[[:cntrl:]]', '', 'g'), 128),
                   ''
                 )
            INTO v_header_label
          FROM public.agent_integration_tokens AS token_record
          WHERE token_record.id = v_header_agent::uuid
          LIMIT 1;

          RETURN jsonb_build_object(
            'actor_kind', 'agent',
            'actor_user_id', NULL,
            'actor_agent_id', v_header_agent,
            'actor_label', COALESCE(v_header_label, v_header_agent)
          );
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'actor_kind', 'system',
    'actor_user_id', NULL,
    'actor_agent_id', NULL,
    'actor_label', NULL
  );
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ega_task_actor() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ega_task_actor() FROM anon;
REVOKE ALL ON FUNCTION public.ega_task_actor() FROM authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.record_task_activity_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor jsonb := public.ega_task_actor();
  changes jsonb := '{}'::jsonb;
  kind text := 'field_change';
  field_name text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.task_activity_events
      (
        owner_user_id, task_id,
        actor_kind, actor_user_id, actor_agent_id, actor_label,
        event_kind, delta, occurred_at
      )
    VALUES
      (
        NEW.owner_user_id,
        NEW.id,
        actor ->> 'actor_kind',
        NULLIF(actor ->> 'actor_user_id', '')::uuid,
        NULLIF(actor ->> 'actor_agent_id', ''),
        NULLIF(actor ->> 'actor_label', ''),
        'created',
        jsonb_build_object('title', NEW.title, 'status', NEW.status),
        NEW.created_at
      );
    RETURN NULL;
  END IF;

  -- Observable fields only. Status/completed_at are owned by the status ledger;
  -- updated_at is bookkeeping and would create false activity.
  FOREACH field_name IN ARRAY ARRAY[
    'title', 'description', 'priority', 'due_date', 'planned_for_date',
    'project_id', 'goal_id', 'estimate_minutes', 'scheduled_start_at',
    'scheduled_end_at', 'calendar_sync_enabled', 'calendar_reminder_minutes',
    'blocked_reason', 'focus_rank', 'archived_at'
  ]
  LOOP
    IF (to_jsonb(NEW) ->> field_name) IS DISTINCT FROM (to_jsonb(OLD) ->> field_name) THEN
      changes := changes || jsonb_build_object(
        field_name,
        jsonb_build_object('from', to_jsonb(OLD) -> field_name, 'to', to_jsonb(NEW) -> field_name)
      );
    END IF;
  END LOOP;

  IF changes = '{}'::jsonb THEN
    RETURN NULL;
  END IF;

  IF changes ? 'archived_at' THEN
    kind := CASE WHEN NEW.archived_at IS NULL THEN 'restored' ELSE 'archived' END;
  END IF;

  INSERT INTO public.task_activity_events
    (
      owner_user_id, task_id,
      actor_kind, actor_user_id, actor_agent_id, actor_label,
      event_kind, delta, occurred_at
    )
  VALUES
    (
      NEW.owner_user_id,
      NEW.id,
      actor ->> 'actor_kind',
      NULLIF(actor ->> 'actor_user_id', '')::uuid,
      NULLIF(actor ->> 'actor_agent_id', ''),
      NULLIF(actor ->> 'actor_label', ''),
      kind,
      changes,
      now()
    );

  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.record_task_status_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor jsonb := public.ega_task_actor();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF public.task_status_is_done(NEW.status) THEN
      INSERT INTO public.task_status_events
        (
          owner_user_id, task_id, from_status, to_status, occurred_at,
          actor_kind, actor_user_id, actor_agent_id, actor_label
        )
      VALUES
        (
          NEW.owner_user_id, NEW.id, NULL, 'done', COALESCE(NEW.completed_at, now()),
          actor ->> 'actor_kind',
          NULLIF(actor ->> 'actor_user_id', '')::uuid,
          NULLIF(actor ->> 'actor_agent_id', ''),
          NULLIF(actor ->> 'actor_label', '')
        );
    END IF;
    RETURN NULL;
  END IF;

  -- Unchanged raw status: no transition to record.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;

  -- A change between two done spellings is not a new completion; recording it
  -- would double-count the day in the heatmap.
  IF public.task_status_is_done(NEW.status) AND public.task_status_is_done(OLD.status) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.task_status_events
    (
      owner_user_id, task_id, from_status, to_status, occurred_at,
      actor_kind, actor_user_id, actor_agent_id, actor_label
    )
  VALUES
    (
      NEW.owner_user_id,
      NEW.id,
      OLD.status,
      CASE WHEN public.task_status_is_done(NEW.status) THEN 'done' ELSE NEW.status END,
      CASE WHEN public.task_status_is_done(NEW.status) THEN COALESCE(NEW.completed_at, now()) ELSE now() END,
      actor ->> 'actor_kind',
      NULLIF(actor ->> 'actor_user_id', '')::uuid,
      NULLIF(actor ->> 'actor_agent_id', ''),
      NULLIF(actor ->> 'actor_label', '')
    );
  RETURN NULL;
END;
$$;
--> statement-breakpoint
-- Reminder scheduling/cancellation is a task change the owner can see. Delivery
-- status changes (sent/processing/failed) are operational and emit nothing.
CREATE OR REPLACE FUNCTION public.record_task_reminder_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor jsonb := public.ega_task_actor();
  v_owner uuid;
  v_kind text;
  v_delta jsonb := '{}'::jsonb;
BEGIN
  v_owner := COALESCE(
    NEW.owner_user_id,
    (SELECT task_record.owner_user_id FROM public.tasks AS task_record WHERE task_record.id = NEW.task_id)
  );
  IF v_owner IS NULL THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'pending' THEN
      RETURN NULL;
    END IF;
    v_kind := 'reminder_scheduled';
    v_delta := jsonb_build_object(
      'remind_at', jsonb_build_object('to', NEW.remind_at),
      'channel', jsonb_build_object('to', NEW.channel)
    );
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status = 'cancelled' AND OLD.status = 'pending' THEN
        v_kind := 'reminder_cancelled';
      ELSIF NEW.status = 'pending' THEN
        v_kind := 'reminder_scheduled';
        v_delta := jsonb_build_object(
          'remind_at', jsonb_build_object('to', NEW.remind_at),
          'channel', jsonb_build_object('to', NEW.channel)
        );
      ELSE
        RETURN NULL;
      END IF;
    ELSIF NEW.status = 'pending' AND NEW.remind_at IS DISTINCT FROM OLD.remind_at THEN
      v_kind := 'reminder_updated';
      v_delta := jsonb_build_object(
        'remind_at', jsonb_build_object('from', OLD.remind_at, 'to', NEW.remind_at)
      );
    ELSIF NEW.status = 'pending' AND NEW.channel IS DISTINCT FROM OLD.channel THEN
      v_kind := 'reminder_updated';
      v_delta := jsonb_build_object(
        'channel', jsonb_build_object('from', OLD.channel, 'to', NEW.channel)
      );
    ELSE
      RETURN NULL;
    END IF;
  END IF;

  INSERT INTO public.task_activity_events
    (
      owner_user_id, task_id,
      actor_kind, actor_user_id, actor_agent_id, actor_label,
      event_kind, delta, occurred_at
    )
  VALUES
    (
      v_owner,
      NEW.task_id,
      actor ->> 'actor_kind',
      NULLIF(actor ->> 'actor_user_id', '')::uuid,
      NULLIF(actor ->> 'actor_agent_id', ''),
      NULLIF(actor ->> 'actor_label', ''),
      v_kind,
      v_delta,
      now()
    );

  RETURN NULL;
END;
$$;
--> statement-breakpoint
-- Snapshot the starter's provenance on the session row. A session stopped later
-- by a different surface keeps the actor who started it.
CREATE OR REPLACE FUNCTION public.stamp_task_session_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor jsonb := public.ega_task_actor();
BEGIN
  NEW.actor_kind := actor ->> 'actor_kind';
  NEW.actor_user_id := NULLIF(actor ->> 'actor_user_id', '')::uuid;
  NEW.actor_agent_id := NULLIF(actor ->> 'actor_agent_id', '');
  NEW.actor_label := NULLIF(actor ->> 'actor_label', '');
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS record_task_reminder_activity ON public.task_reminders;
CREATE TRIGGER record_task_reminder_activity
AFTER INSERT OR UPDATE ON public.task_reminders
FOR EACH ROW EXECUTE FUNCTION public.record_task_reminder_activity();
--> statement-breakpoint
DROP TRIGGER IF EXISTS stamp_task_session_actor ON public.task_sessions;
CREATE TRIGGER stamp_task_session_actor
BEFORE INSERT ON public.task_sessions
FOR EACH ROW EXECUTE FUNCTION public.stamp_task_session_actor();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_task_reminder_activity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_task_reminder_activity() FROM anon;
REVOKE ALL ON FUNCTION public.stamp_task_session_actor() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.stamp_task_session_actor() FROM anon;
--> statement-breakpoint
-- The ledger is append-only for product clients. RLS already denies writes
-- (there is no write policy); these revokes keep the grant explicit too.
REVOKE INSERT, UPDATE, DELETE ON public.task_activity_events FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.task_activity_events FROM anon;
REVOKE UPDATE, DELETE ON public.task_status_events FROM authenticated;
REVOKE UPDATE, DELETE ON public.task_status_events FROM anon;

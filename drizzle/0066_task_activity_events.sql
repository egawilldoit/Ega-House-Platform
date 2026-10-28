-- Durable task activity ledger (EGA-784, stage 1).
--
-- Observable task field changes are recorded by a SECURITY DEFINER trigger, so
-- product clients cannot forge history. Status transitions remain in the
-- existing task_status_events ledger (analytics consumers depend on it); the
-- read model unions both plus timer-session evidence.
--
-- Actor attribution: `auth.uid()` is a verified server context, so an
-- authenticated write is attributed to its owner. Writes without that claim
-- (service-role agent transports, legacy jobs) are recorded as `system` rather
-- than inventing an agent identity; linking MCP client identity to these rows is
-- follow-up work owned by the agent-surface foundation.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."task_activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid DEFAULT auth.uid() NOT NULL,
	"task_id" uuid,
	"actor_kind" varchar(16) NOT NULL,
	"actor_user_id" uuid,
	"actor_label" text,
	"event_kind" varchar(32) NOT NULL,
	"delta" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_activity_events_actor_kind_check" CHECK ("actor_kind" in ('owner', 'agent', 'system', 'unknown')),
	CONSTRAINT "task_activity_events_event_kind_check" CHECK ("event_kind" in ('created', 'field_change', 'archived', 'restored'))
);
--> statement-breakpoint
ALTER TABLE "public"."task_activity_events"
  ADD CONSTRAINT "task_activity_events_task_id_tasks_id_fk"
  FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_activity_events_owner_task_time_idx"
  ON "public"."task_activity_events" USING btree ("owner_user_id","task_id","occurred_at");
--> statement-breakpoint
ALTER TABLE "public"."task_activity_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Append-only from the product perspective: select only, no client writes.
DROP POLICY IF EXISTS "task_activity_events_owner_select" ON "public"."task_activity_events";
CREATE POLICY "task_activity_events_owner_select" ON "public"."task_activity_events"
  FOR SELECT TO authenticated
  USING (owner_user_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.record_task_activity_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  changes jsonb := '{}'::jsonb;
  kind text := 'field_change';
  field_name text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.task_activity_events
      (owner_user_id, task_id, actor_kind, actor_user_id, event_kind, delta, occurred_at)
    VALUES
      (
        NEW.owner_user_id,
        NEW.id,
        CASE WHEN uid IS NOT NULL THEN 'owner' ELSE 'system' END,
        uid,
        'created',
        jsonb_build_object('title', NEW.title, 'status', NEW.status),
        NEW.created_at
      );
    RETURN NULL;
  END IF;

  -- Observable fields only. Status/completed_at are owned by the status ledger;
  -- updated_at is bookkeeping and would create false activity.
  FOREACH field_name IN ARRAY ARRAY[
    'title', 'description', 'priority', 'due_date', 'project_id', 'goal_id',
    'estimate_minutes', 'scheduled_start_at', 'scheduled_end_at',
    'calendar_sync_enabled', 'calendar_reminder_minutes', 'blocked_reason',
    'focus_rank', 'archived_at'
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
    changes := jsonb_build_object('archived_at', changes -> 'archived_at');
  END IF;

  INSERT INTO public.task_activity_events
    (owner_user_id, task_id, actor_kind, actor_user_id, event_kind, delta, occurred_at)
  VALUES
    (
      NEW.owner_user_id,
      NEW.id,
      CASE WHEN uid IS NOT NULL THEN 'owner' ELSE 'system' END,
      uid,
      kind,
      changes,
      now()
    );

  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS record_task_activity_event ON public.tasks;
CREATE TRIGGER record_task_activity_event
AFTER INSERT OR UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.record_task_activity_event();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_task_activity_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_task_activity_event() FROM anon;

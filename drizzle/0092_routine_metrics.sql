-- Optional bounded routine metrics inside the daily check-in (PO-10, #351).
--
-- A versioned `routine` JSONB column on the single daily_checkins row: no
-- habits/routine_templates/habit_completions tables. Every field is nullable;
-- null means unknown/unrecorded, an explicit value (including 0) is a
-- recorded fact, and routine minutes never create timer sessions or work
-- time. Weekly run counts derive from daily records at read time.
--
-- Rollout: additive column. Apply before deploying code that reads/writes
-- `routine`. Reads on pre-0092 rows treat the column as NULL (no metrics);
-- on pre-0092 deployments the read path retries without the column.
ALTER TABLE "public"."daily_checkins"
  ADD COLUMN IF NOT EXISTS "routine" jsonb;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.valid_routine_metrics(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  item text;
  metric jsonb;
BEGIN
  IF value IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(value) <> 'object' THEN RETURN false; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(value)) > 6 THEN RETURN false; END IF;
  FOR item IN SELECT jsonb_object_keys(value) LOOP
    IF item NOT IN ('runMinutes', 'runCompleted', 'runSkipped', 'chessMinutes', 'sleepHours', 'leisureMinutes') THEN
      RETURN false;
    END IF;
    metric := value->item;
    IF metric IS NULL OR metric = 'null'::jsonb THEN
      CONTINUE;
    END IF;
    IF item IN ('runCompleted', 'runSkipped') THEN
      IF jsonb_typeof(metric) IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
    ELSIF item = 'sleepHours' THEN
      -- 0..24 in half-hour steps.
      IF jsonb_typeof(metric) IS DISTINCT FROM 'number'
         OR (metric #>> '{}')::numeric < 0
         OR (metric #>> '{}')::numeric > 24
         OR MOD((metric #>> '{}')::numeric * 2, 1) <> 0 THEN
        RETURN false;
      END IF;
    ELSE
      -- Whole minutes 0..1440.
      IF jsonb_typeof(metric) IS DISTINCT FROM 'number'
         OR (metric #>> '{}') !~ '^(0|[1-9][0-9]*)$'
         OR (metric #>> '{}')::numeric > 1440 THEN
        RETURN false;
      END IF;
    END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN others THEN RETURN false;
END $$;
--> statement-breakpoint
ALTER TABLE "public"."daily_checkins"
  DROP CONSTRAINT IF EXISTS "daily_checkins_routine_check";
--> statement-breakpoint
ALTER TABLE "public"."daily_checkins"
  ADD CONSTRAINT "daily_checkins_routine_check"
  CHECK (public.valid_routine_metrics(routine));

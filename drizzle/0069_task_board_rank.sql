-- Persisted manual board order for Task status columns (EGA-785).
--
-- `board_rank` is a fractional string owned by one Task and independent of
-- `focus_rank` (the Today pin). It only has meaning inside the Task's current
-- status column: moving a card across columns writes a rank relative to the
-- target column's neighbours in the same row update.
--
-- Ordering contract: `(board_rank, id)`. The column uses the C collation so the
-- database's byte order matches the domain comparator, and the format check
-- rejects anything the fractional-rank helper could not have produced.
--
-- New/other-surface writes: a Task inserted without a rank, or changed to
-- another status without an explicit rank, is appended to the end of its
-- column by a trigger using a timestamp-shaped key. Board moves always supply
-- an explicit rank that differs from the card's previous rank (the move
-- service guarantees this), so the trigger leaves them untouched.
--
-- RLS: `tasks` already has owner-scoped policies from 0038; the new column is
-- covered by the same table-level policies.

--> statement-breakpoint
ALTER TABLE "public"."tasks" ADD COLUMN IF NOT EXISTS "board_rank" text COLLATE "C";
--> statement-breakpoint
-- Deterministic backfill: existing Tasks receive the order the board showed
-- before this feature (most recently updated first inside each column, id as
-- the stable tie-break). Width 10 keeps the keys short and lexicographically
-- ordered; later drags insert fractional keys between them.
WITH "ranked_tasks" AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "owner_user_id", "status"
      ORDER BY "updated_at" DESC, "id" ASC
    ) AS "position"
  FROM "public"."tasks"
  WHERE "board_rank" IS NULL
)
UPDATE "public"."tasks" AS "task_record"
SET "board_rank" = lpad("ranked_tasks"."position"::text, 10, '0')
FROM "ranked_tasks"
WHERE "task_record"."id" = "ranked_tasks"."id";
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tasks_board_rank_format_check'
      AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE "public"."tasks"
      ADD CONSTRAINT "tasks_board_rank_format_check"
      CHECK (
        "board_rank" IS NULL
        OR (length("board_rank") BETWEEN 1 AND 512 AND "board_rank" ~ '^[0-9A-Z]+$')
      );
  END IF;
END;
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_owner_status_board_rank_idx"
  ON "public"."tasks" USING btree ("owner_user_id","status","board_rank");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assign_task_board_rank()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Append when the caller supplied no rank, or when a status change came from
  -- another surface (drawer, Today, mobile, agent) without an explicit rank.
  -- A board move sets both status and a rank that differs from the old one, so
  -- it keeps its own key.
  IF NEW.board_rank IS NULL
     OR (
       TG_OP = 'UPDATE'
       AND NEW.status IS DISTINCT FROM OLD.status
       AND NEW.board_rank IS NOT DISTINCT FROM OLD.board_rank
     ) THEN
    NEW.board_rank := to_char(clock_timestamp() AT TIME ZONE 'utc', 'YYYYMMDDHH24MISSUS');
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "assign_task_board_rank" ON "public"."tasks";
CREATE TRIGGER "assign_task_board_rank"
BEFORE INSERT OR UPDATE OF "status", "board_rank" ON "public"."tasks"
FOR EACH ROW EXECUTE FUNCTION public.assign_task_board_rank();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.assign_task_board_rank() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_task_board_rank() FROM anon;

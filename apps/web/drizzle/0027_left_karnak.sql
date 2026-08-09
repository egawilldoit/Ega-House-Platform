ALTER TABLE "task_recurrences" ADD COLUMN "anchor_date" date;--> statement-breakpoint
ALTER TABLE "task_recurrences" ADD COLUMN "timezone" varchar(128);--> statement-breakpoint
ALTER TABLE "task_recurrences" ADD COLUMN "next_occurrence_date" date;--> statement-breakpoint
ALTER TABLE "task_recurrences" ADD COLUMN "last_generated_at" timestamp with time zone;--> statement-breakpoint
UPDATE "task_recurrences"
SET
  "anchor_date" = current_date,
  "timezone" = 'UTC',
  "next_occurrence_date" = CASE
    WHEN "rule" = 'daily' THEN current_date + 1
    WHEN "rule" = 'weekdays' THEN current_date + (
      CASE EXTRACT(DOW FROM current_date)::int
        WHEN 5 THEN 3
        WHEN 6 THEN 2
        ELSE 1
      END
    )
    WHEN "rule" = 'monthly:day-of-month' THEN (
      date_trunc('month', current_date)::date
      + interval '1 month'
      + (
        LEAST(
          EXTRACT(DAY FROM current_date)::int,
          EXTRACT(
            DAY FROM date_trunc('month', current_date)::date + interval '2 months - 1 day'
          )::int
        ) - 1
      ) * interval '1 day'
    )::date
    WHEN "rule" = 'weekly:sunday' THEN current_date + (CASE WHEN (0 - EXTRACT(DOW FROM current_date)::int + 7) % 7 = 0 THEN 7 ELSE (0 - EXTRACT(DOW FROM current_date)::int + 7) % 7 END)
    WHEN "rule" = 'weekly:monday' THEN current_date + (CASE WHEN (1 - EXTRACT(DOW FROM current_date)::int + 7) % 7 = 0 THEN 7 ELSE (1 - EXTRACT(DOW FROM current_date)::int + 7) % 7 END)
    WHEN "rule" = 'weekly:tuesday' THEN current_date + (CASE WHEN (2 - EXTRACT(DOW FROM current_date)::int + 7) % 7 = 0 THEN 7 ELSE (2 - EXTRACT(DOW FROM current_date)::int + 7) % 7 END)
    WHEN "rule" = 'weekly:wednesday' THEN current_date + (CASE WHEN (3 - EXTRACT(DOW FROM current_date)::int + 7) % 7 = 0 THEN 7 ELSE (3 - EXTRACT(DOW FROM current_date)::int + 7) % 7 END)
    WHEN "rule" = 'weekly:thursday' THEN current_date + (CASE WHEN (4 - EXTRACT(DOW FROM current_date)::int + 7) % 7 = 0 THEN 7 ELSE (4 - EXTRACT(DOW FROM current_date)::int + 7) % 7 END)
    WHEN "rule" = 'weekly:friday' THEN current_date + (CASE WHEN (5 - EXTRACT(DOW FROM current_date)::int + 7) % 7 = 0 THEN 7 ELSE (5 - EXTRACT(DOW FROM current_date)::int + 7) % 7 END)
    WHEN "rule" = 'weekly:saturday' THEN current_date + (CASE WHEN (6 - EXTRACT(DOW FROM current_date)::int + 7) % 7 = 0 THEN 7 ELSE (6 - EXTRACT(DOW FROM current_date)::int + 7) % 7 END)
    ELSE current_date + 1
  END
WHERE "anchor_date" IS NULL
  OR "timezone" IS NULL
  OR "next_occurrence_date" IS NULL;--> statement-breakpoint
ALTER TABLE "task_recurrences" ALTER COLUMN "anchor_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "task_recurrences" ALTER COLUMN "timezone" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "task_recurrences" ALTER COLUMN "next_occurrence_date" SET NOT NULL;

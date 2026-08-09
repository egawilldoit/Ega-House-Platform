-- EGA Runner PR watch + bounded repair graph.
-- Additive and idempotent: production may already contain a subset of fields.

--> statement-breakpoint
ALTER TABLE "automation"."implementation_runs" ADD COLUMN IF NOT EXISTS "project_slug" varchar(128);
ALTER TABLE "automation"."implementation_runs" ADD COLUMN IF NOT EXISTS "evidence_dir" varchar(1024);
ALTER TABLE "automation"."implementation_runs" ADD COLUMN IF NOT EXISTS "authorized_paths" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "automation"."implementation_runs" ADD COLUMN IF NOT EXISTS "validation_commands" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "automation"."implementation_runs" ADD COLUMN IF NOT EXISTS "repair_attempt_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "automation"."implementation_runs" ADD COLUMN IF NOT EXISTS "max_repair_attempts" integer NOT NULL DEFAULT 3;
ALTER TABLE "automation"."implementation_runs" ADD COLUMN IF NOT EXISTS "last_observed_pr_sha" varchar(64);
ALTER TABLE "automation"."implementation_runs" ADD COLUMN IF NOT EXISTS "last_check_state" varchar(32);
ALTER TABLE "automation"."implementation_runs" ADD COLUMN IF NOT EXISTS "last_review_state" varchar(64);
ALTER TABLE "automation"."implementation_runs" ADD COLUMN IF NOT EXISTS "last_repair_at" timestamptz;
ALTER TABLE "automation"."implementation_runs" ADD COLUMN IF NOT EXISTS "next_check_at" timestamptz;

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "implementation_runs_pr_monitor_due_idx"
  ON "automation"."implementation_runs" ("next_check_at")
  WHERE "status" IN ('pr_open', 'awaiting_review', 'ready_to_merge');

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "implementation_runs_pr_number_idx"
  ON "automation"."implementation_runs" ("pr_number")
  WHERE "pr_number" IS NOT NULL;

--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'automation'
      AND table_name = 'implementation_runs'
      AND column_name = 'status'
  ) THEN
    COMMENT ON COLUMN "automation"."implementation_runs"."status" IS
      'Execution graph state: queued, preparing, running, validation_failed, pr_failed, pr_open, repairing, awaiting_review, ready_to_merge, needs_human, merged, deployed, failed, cancelled, stale.';
  END IF;
END
$$;

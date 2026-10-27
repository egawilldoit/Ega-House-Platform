-- Server-owned undo receipts for bounded bulk task operations (EGA-786).
--
-- A receipt is written only after a task mutation actually applied, and records
-- exactly the columns that operation changed (before + after). Undo re-reads the
-- task, refuses when the recorded after-values no longer hold (a newer edit won),
-- restores only the recorded columns, and marks the receipt consumed. Receipts
-- expire; they are the durable audit trail and are never deleted by clients.
--
-- The operation id is generated server-side per bulk request, so a duplicate
-- client submission creates a distinct operation rather than reusing receipts.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."task_operation_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid DEFAULT auth.uid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"action" varchar(32) NOT NULL,
	"before_values" jsonb NOT NULL,
	"after_values" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"undone_at" timestamp with time zone,
	CONSTRAINT "task_operation_receipts_action_check" CHECK ("action" in ('archive', 'restore', 'patch'))
);
--> statement-breakpoint
ALTER TABLE "public"."task_operation_receipts"
  ADD CONSTRAINT "task_operation_receipts_task_id_tasks_id_fk"
  FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_operation_receipts_owner_operation_idx"
  ON "public"."task_operation_receipts" USING btree ("owner_user_id","operation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_operation_receipts_owner_task_idx"
  ON "public"."task_operation_receipts" USING btree ("owner_user_id","task_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_operation_receipts_operation_task_unique"
  ON "public"."task_operation_receipts" USING btree ("operation_id","task_id");
--> statement-breakpoint
ALTER TABLE "public"."task_operation_receipts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "task_operation_receipts_owner_select" ON "public"."task_operation_receipts";
CREATE POLICY "task_operation_receipts_owner_select" ON "public"."task_operation_receipts"
  FOR SELECT TO authenticated
  USING (owner_user_id = (SELECT auth.uid()));
--> statement-breakpoint
DROP POLICY IF EXISTS "task_operation_receipts_owner_insert" ON "public"."task_operation_receipts";
CREATE POLICY "task_operation_receipts_owner_insert" ON "public"."task_operation_receipts"
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = (SELECT auth.uid()));
--> statement-breakpoint
-- Undo marks a receipt consumed; clients cannot delete receipts and cannot move
-- them to another owner.
DROP POLICY IF EXISTS "task_operation_receipts_owner_update" ON "public"."task_operation_receipts";
CREATE POLICY "task_operation_receipts_owner_update" ON "public"."task_operation_receipts"
  FOR UPDATE TO authenticated
  USING (owner_user_id = (SELECT auth.uid()))
  WITH CHECK (owner_user_id = (SELECT auth.uid()));

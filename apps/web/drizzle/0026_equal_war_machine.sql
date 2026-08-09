CREATE TABLE "task_recurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid DEFAULT auth.uid(),
	"task_id" uuid NOT NULL,
	"rule" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_recurrences_rule_check" CHECK ("task_recurrences"."rule" in ('daily', 'weekdays', 'weekly:sunday', 'weekly:monday', 'weekly:tuesday', 'weekly:wednesday', 'weekly:thursday', 'weekly:friday', 'weekly:saturday', 'monthly:day-of-month'))
);
--> statement-breakpoint
ALTER TABLE "task_recurrences" ADD CONSTRAINT "task_recurrences_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_recurrences_owner_user_id_idx" ON "task_recurrences" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "task_recurrences_task_id_idx" ON "task_recurrences" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_recurrences_task_id_unique" ON "task_recurrences" USING btree ("task_id");
--> statement-breakpoint
ALTER TABLE "task_recurrences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "task_recurrences" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "task_recurrences_select_own"
ON "task_recurrences"
FOR SELECT
TO authenticated
USING (owner_user_id = auth.uid());
--> statement-breakpoint
CREATE POLICY "task_recurrences_insert_own"
ON "task_recurrences"
FOR INSERT
TO authenticated
WITH CHECK (
  owner_user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM "tasks"
    WHERE "tasks"."id" = "task_recurrences"."task_id"
      AND "tasks"."owner_user_id" = auth.uid()
  )
);
--> statement-breakpoint
CREATE POLICY "task_recurrences_update_own"
ON "task_recurrences"
FOR UPDATE
TO authenticated
USING (owner_user_id = auth.uid())
WITH CHECK (
  owner_user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM "tasks"
    WHERE "tasks"."id" = "task_recurrences"."task_id"
      AND "tasks"."owner_user_id" = auth.uid()
  )
);
--> statement-breakpoint
CREATE POLICY "task_recurrences_delete_own"
ON "task_recurrences"
FOR DELETE
TO authenticated
USING (owner_user_id = auth.uid());

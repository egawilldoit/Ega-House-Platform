CREATE TABLE "task_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid DEFAULT auth.uid(),
	"task_id" uuid NOT NULL,
	"remind_at" timestamp with time zone NOT NULL,
	"channel" varchar(32) DEFAULT 'email' NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "task_reminders_owner_user_id_idx" ON "task_reminders" USING btree ("owner_user_id");
--> statement-breakpoint
CREATE INDEX "task_reminders_task_id_idx" ON "task_reminders" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX "task_reminders_pending_delivery_idx" ON "task_reminders" USING btree ("status","channel","remind_at") WHERE "task_reminders"."status" = 'pending';
--> statement-breakpoint
ALTER TABLE "task_reminders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "task_reminders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "task_reminders_select_own"
ON "task_reminders"
FOR SELECT
TO authenticated
USING (owner_user_id = auth.uid());
--> statement-breakpoint
CREATE POLICY "task_reminders_insert_own"
ON "task_reminders"
FOR INSERT
TO authenticated
WITH CHECK (
  owner_user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM "tasks"
    WHERE "tasks"."id" = "task_reminders"."task_id"
      AND "tasks"."owner_user_id" = auth.uid()
  )
);
--> statement-breakpoint
CREATE POLICY "task_reminders_update_own"
ON "task_reminders"
FOR UPDATE
TO authenticated
USING (owner_user_id = auth.uid())
WITH CHECK (
  owner_user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM "tasks"
    WHERE "tasks"."id" = "task_reminders"."task_id"
      AND "tasks"."owner_user_id" = auth.uid()
  )
);
--> statement-breakpoint
CREATE POLICY "task_reminders_delete_own"
ON "task_reminders"
FOR DELETE
TO authenticated
USING (owner_user_id = auth.uid());

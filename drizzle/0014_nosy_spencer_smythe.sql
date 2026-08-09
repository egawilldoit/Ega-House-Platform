ALTER TABLE "tasks" ADD COLUMN "planned_for_date" date;--> statement-breakpoint
CREATE INDEX "tasks_owner_user_id_planned_for_date_idx" ON "tasks" USING btree ("owner_user_id","planned_for_date");
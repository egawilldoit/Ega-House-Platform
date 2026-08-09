ALTER TABLE "tasks" ADD COLUMN "focus_rank" integer;--> statement-breakpoint
CREATE INDEX "tasks_owner_user_id_focus_rank_idx" ON "tasks" USING btree ("owner_user_id","focus_rank");
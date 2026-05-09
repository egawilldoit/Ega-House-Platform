ALTER TABLE "tasks" ADD COLUMN "scheduled_start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "scheduled_end_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "tasks_owner_user_id_scheduled_start_at_idx" ON "tasks" USING btree ("owner_user_id","scheduled_start_at");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_scheduled_window_check" CHECK ((
        ("tasks"."scheduled_start_at" is null and "tasks"."scheduled_end_at" is null)
        or
        ("tasks"."scheduled_start_at" is not null and "tasks"."scheduled_end_at" is not null and "tasks"."scheduled_start_at" < "tasks"."scheduled_end_at")
      ));
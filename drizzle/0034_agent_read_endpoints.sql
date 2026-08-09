CREATE TABLE "agent_integration_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"token_id" uuid NOT NULL,
	"action" varchar(64) NOT NULL,
	"resource_type" varchar(32),
	"resource_id" uuid,
	"outcome" varchar(16) NOT NULL,
	"ip_address" varchar(45),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_external_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"source" varchar(64) NOT NULL,
	"source_id" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_external_refs" ADD CONSTRAINT "task_external_refs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_external_refs_owner_source_source_id_unique" ON "task_external_refs" USING btree ("owner_user_id","source","source_id");--> statement-breakpoint
CREATE INDEX "task_external_refs_owner_idx" ON "task_external_refs" USING btree ("owner_user_id");
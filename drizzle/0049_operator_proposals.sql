CREATE TABLE "operator_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision" integer NOT NULL,
	"owner_user_id" uuid DEFAULT auth.uid() NOT NULL,
	"local_date" date NOT NULL,
	"time_context_id" varchar(256) NOT NULL,
	"baseline_hash" text NOT NULL,
	"proposed_task_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"task_versions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parent_proposal_id" uuid,
	"idempotency_key" varchar(128) NOT NULL,
	"status" varchar(32) DEFAULT 'generated' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"result" jsonb,
	"ai_ref" text,
	CONSTRAINT "operator_proposals_revision_check" CHECK ("revision" > 0),
	CONSTRAINT "operator_proposals_status_check" CHECK ("status" in ('generated','revised','approved','applying','applied','partially_applied','stale','dismissed')),
	CONSTRAINT "operator_proposals_idempotency_key_not_blank" CHECK (length(btrim("idempotency_key")) > 0)
);
--> statement-breakpoint
ALTER TABLE "operator_proposals" ADD CONSTRAINT "operator_proposals_parent_proposal_id_fkey" FOREIGN KEY ("parent_proposal_id") REFERENCES "public"."operator_proposals"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE INDEX "operator_proposals_owner_user_id_idx" ON "operator_proposals" USING btree ("owner_user_id");
--> statement-breakpoint
CREATE INDEX "operator_proposals_owner_local_date_idx" ON "operator_proposals" USING btree ("owner_user_id","local_date");
--> statement-breakpoint
CREATE INDEX "operator_proposals_owner_status_idx" ON "operator_proposals" USING btree ("owner_user_id","status");
--> statement-breakpoint
CREATE INDEX "operator_proposals_owner_created_at_idx" ON "operator_proposals" USING btree ("owner_user_id","created_at" DESC);
--> statement-breakpoint
CREATE INDEX "operator_proposals_parent_id_idx" ON "operator_proposals" USING btree ("parent_proposal_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "operator_proposals_owner_idempotency_key_unique" ON "operator_proposals" USING btree ("owner_user_id","idempotency_key");
--> statement-breakpoint
ALTER TABLE "operator_proposals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "operator_proposals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "operator_proposals_select_own"
ON "operator_proposals"
FOR SELECT
TO authenticated
USING (owner_user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "operator_proposals_insert_own"
ON "operator_proposals"
FOR INSERT
TO authenticated
WITH CHECK (owner_user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "operator_proposals_update_own"
ON "operator_proposals"
FOR UPDATE
TO authenticated
USING (owner_user_id = auth.uid())
WITH CHECK (owner_user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "operator_proposals_delete_own"
ON "operator_proposals"
FOR DELETE
TO authenticated
USING (owner_user_id = auth.uid());

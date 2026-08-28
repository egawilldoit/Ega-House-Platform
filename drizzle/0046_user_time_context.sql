CREATE TABLE "user_time_context" (
	"user_id" uuid PRIMARY KEY DEFAULT auth.uid() NOT NULL,
	"iana_timezone" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_time_context" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_time_context" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "user_time_context_select_own"
ON "user_time_context"
FOR SELECT
TO authenticated
USING (user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "user_time_context_insert_own"
ON "user_time_context"
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "user_time_context_update_own"
ON "user_time_context"
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "user_time_context_delete_own"
ON "user_time_context"
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

CREATE TABLE "agent_integration_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" varchar(256) NOT NULL,
	"token_prefix" varchar(16) NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_token_prefix_format" CHECK (token_prefix ~ '^[0-9a-f]{16}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_token_prefix_unique" ON "agent_integration_tokens" USING btree ("token_prefix");--> statement-breakpoint
CREATE INDEX "agent_tokens_owner_idx" ON "agent_integration_tokens" USING btree ("owner_user_id");--> statement-breakpoint
ALTER TABLE "agent_integration_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "agent_integration_tokens" FORCE ROW LEVEL SECURITY;

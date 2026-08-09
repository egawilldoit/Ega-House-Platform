ALTER TABLE "week_reviews" ADD COLUMN "official_email_status" varchar(32);--> statement-breakpoint
ALTER TABLE "week_reviews" ADD COLUMN "official_email_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "week_reviews" ADD COLUMN "official_email_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "week_reviews" ADD COLUMN "official_email_message_id" text;--> statement-breakpoint
ALTER TABLE "week_reviews" ADD COLUMN "official_email_failure_reason" text;--> statement-breakpoint
CREATE INDEX "week_reviews_official_email_delivery_idx" ON "week_reviews" USING btree ("owner_user_id","week_start","official_email_status","official_email_sent_at");
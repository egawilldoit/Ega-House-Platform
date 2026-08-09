WITH ranked_reviews AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY owner_user_id, week_start
      ORDER BY updated_at DESC, created_at DESC, id DESC
    ) AS row_rank
  FROM "week_reviews"
)
DELETE FROM "week_reviews"
WHERE id IN (
  SELECT id
  FROM ranked_reviews
  WHERE row_rank > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX "week_reviews_owner_user_id_week_start_unique" ON "week_reviews" USING btree ("owner_user_id","week_start");

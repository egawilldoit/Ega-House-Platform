-- MONEY-02: complete expense management and trustworthy reads.
--
-- MONEY-01 (0093) already installed the grant-aware SELECT/INSERT/UPDATE
-- policies for OAuth clients and kept the 0088 immutable-column, version +1 and
-- no-undelete trigger. MONEY-02 reuses that persistence contract unchanged: no
-- second ledger, no policy rewrite and no applied-migration edit.
--
-- What this migration adds is the read-path support the issue requires for
-- reachable continuation, complete exports and same-cutoff summaries: one
-- active-row covering index on the canonical ordering
-- (owner_user_id, occurred_at DESC, id DESC) with the category/amount columns
-- used by summaries and CSV. Soft-deleted rows are excluded from the index, so
-- replay-after-deletion still uses the existing unique idempotency index.
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "personal_expenses_owner_active_read_idx"
  ON "public"."personal_expenses" USING btree ("owner_user_id", "occurred_at" DESC, "id" DESC)
  INCLUDE ("category", "amount_minor")
  WHERE "deleted_at" IS NULL;

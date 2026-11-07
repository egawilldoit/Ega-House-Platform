-- Owner-scoped personal expense ledger (PO-06 Slice A, issue #346).
--
-- Single-currency MAD ledger. Money is stored as a positive integer number of
-- centimes (22.50 MAD = 2250) so no floating point amount can be persisted.
-- One row per expense, soft-delete only, optimistic concurrency via `version`.
--
-- Owner isolation:
--   * `owner_user_id` defaults to the verified `auth.uid()`.
--   * RLS and every data-access statement scope by the owner.
--   * Direct-user JWT policy: an OAuth/MCP `client_id` token is not a normal
--     direct-user finance channel and is denied.
--
-- Idempotency:
--   * `(owner_user_id, idempotency_key)` is unique. A concurrent double submit
--     can create only one row; the loser classifies the winner as a replay or
--     a conflicting payload.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."personal_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid DEFAULT auth.uid() NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'MAD' NOT NULL,
	"category" varchar(32) NOT NULL,
	"note" varchar(500),
	"merchant" varchar(120),
	"need_vs_want" varchar(8) NOT NULL,
	"payment_method" varchar(32),
	"idempotency_key" varchar(128) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_expenses_amount_minor_check"
		CHECK ("amount_minor" >= 1 AND "amount_minor" <= 2147483647),
	CONSTRAINT "personal_expenses_currency_check"
		CHECK ("currency" = 'MAD'),
	CONSTRAINT "personal_expenses_category_check"
		CHECK ("category" in ('coffee', 'groceries', 'eating_out', 'transport', 'bills', 'subscriptions', 'household', 'health', 'other')),
	CONSTRAINT "personal_expenses_need_vs_want_check"
		CHECK ("need_vs_want" in ('need', 'want')),
	CONSTRAINT "personal_expenses_payment_method_check"
		CHECK ("payment_method" is null OR "payment_method" in ('cash', 'card', 'bank_transfer', 'mobile_wallet', 'other')),
	CONSTRAINT "personal_expenses_version_check"
		CHECK ("version" > 0),
	CONSTRAINT "personal_expenses_idempotency_key_check"
		CHECK (btrim("idempotency_key") <> ''),
	CONSTRAINT "personal_expenses_note_check"
		CHECK ("note" is null OR btrim("note") <> ''),
	CONSTRAINT "personal_expenses_merchant_check"
		CHECK ("merchant" is null OR btrim("merchant") <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "personal_expenses_owner_idempotency_key_unique"
	ON "public"."personal_expenses" USING btree ("owner_user_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "personal_expenses_owner_occurred_at_idx"
	ON "public"."personal_expenses" USING btree ("owner_user_id", "occurred_at" DESC, "id" DESC);
--> statement-breakpoint
ALTER TABLE "public"."personal_expenses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "personal_expenses_direct_user_select" ON "public"."personal_expenses";
CREATE POLICY "personal_expenses_direct_user_select" ON "public"."personal_expenses"
  FOR SELECT TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "personal_expenses_direct_user_insert" ON "public"."personal_expenses";
CREATE POLICY "personal_expenses_direct_user_insert" ON "public"."personal_expenses"
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "personal_expenses_direct_user_update" ON "public"."personal_expenses";
CREATE POLICY "personal_expenses_direct_user_update" ON "public"."personal_expenses"
  FOR UPDATE TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  )
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "personal_expenses_direct_user_delete" ON "public"."personal_expenses";
CREATE POLICY "personal_expenses_direct_user_delete" ON "public"."personal_expenses"
  FOR DELETE TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  );
--> statement-breakpoint
REVOKE ALL ON TABLE "public"."personal_expenses" FROM anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."personal_expenses" TO authenticated;

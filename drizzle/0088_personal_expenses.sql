-- Owner-scoped personal expense ledger (PO-06 Slice A, issue #346).
--
-- Single-currency MAD ledger. Money is stored as a positive integer number of
-- centimes (22.50 MAD = 2250) so no floating point amount can be persisted.
-- One row per expense, soft-delete only, optimistic concurrency via `version`.
--
-- Migration sequencing: main now has 0079_notification_events_policy at
-- journal `when` 1787880000029, and this migration is 0088 at `when`
-- 1787880000051, so it applies after 0079. The known remote
-- feat/mcp-platform-hardening-expansion branch still carries its own
-- 0079-0087 at `when` 1787880000042..50; that branch must renumber to 0089+
-- and raise its journal `when` values above 1787880000051 before merging.
-- Drizzle applies an entry only when its `when` is greater than the last
-- applied migration's `created_at`. No historical migration is edited by
-- this file.
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
--   * `create_fingerprint` is a SHA-256 hex receipt of the immutable original
--     create payload (not the raw payload). It is never exposed on the wire,
--     never duplicates the raw note/merchant, and authenticated callers cannot
--     update it.
--
-- Mutation policy: soft delete only. Authenticated has SELECT/INSERT and
-- column-level UPDATE on mutable columns; DELETE is not granted and no DELETE
-- RLS policy exists. A BEFORE UPDATE trigger refuses immutable-column changes,
-- any post-delete mutation/undelete and any version change other than +1.
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
	"create_fingerprint" varchar(64) NOT NULL,
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
	CONSTRAINT "personal_expenses_create_fingerprint_check"
		CHECK ("create_fingerprint" ~ '^[0-9a-f]{64}$'),
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
ALTER TABLE "public"."personal_expenses" FORCE ROW LEVEL SECURITY;
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
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_personal_expense_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $guard$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.create_fingerprint IS DISTINCT FROM OLD.create_fingerprint
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Immutable expense fields cannot be changed.'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'A deleted expense cannot be modified or restored.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
    RAISE EXCEPTION 'Expense version must increase by exactly one.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$guard$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "personal_expenses_update_guard" ON "public"."personal_expenses";
CREATE TRIGGER "personal_expenses_update_guard"
  BEFORE UPDATE ON "public"."personal_expenses"
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_personal_expense_update();
--> statement-breakpoint
REVOKE ALL ON TABLE "public"."personal_expenses" FROM anon;
--> statement-breakpoint
REVOKE ALL ON TABLE "public"."personal_expenses" FROM authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE "public"."personal_expenses" TO authenticated;
--> statement-breakpoint
GRANT INSERT ON TABLE "public"."personal_expenses" TO authenticated;
--> statement-breakpoint
GRANT UPDATE (
	"occurred_at",
	"amount_minor",
	"category",
	"note",
	"merchant",
	"need_vs_want",
	"payment_method",
	"version",
	"deleted_at",
	"updated_at"
) ON TABLE "public"."personal_expenses" TO authenticated;

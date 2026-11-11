-- MONEY-04: record income and savings movements in one ledger.
--
-- Baseline: 0095 (MONEY-03) is the journal tail for Money. It already added
-- `kind`, `direction`, `booking_date`, `counts_in_daily` and `period_id`, the
-- owner/booking-date trigger (owner timezone, product-timezone fallback, and
-- recomputation when `occurred_at` changes), the opening guards and the
-- extended immutability/version guard. This migration is strictly additive on
-- top of that state and never replaces a stronger MONEY-03 rule with a weaker
-- one:
--
--   * adds `purpose` and its bounded check;
--   * makes the daily-inclusion default kind-aware at the insert boundary
--     instead of a single `true` column default, so an omitted flag can never
--     mark income or a savings transfer as daily spending;
--   * adds one kind-shape check covering all five kinds (the opening zero rule
--     stays owned by 0095's amount check);
--   * grants only the mutable movement columns.
--
-- Existing expenses keep their ids, amounts, versions, soft-delete history,
-- idempotency receipts and booking days. No second ledger, period table or
-- opening owner is introduced.

ALTER TABLE "public"."personal_expenses"
  ADD COLUMN IF NOT EXISTS "purpose" varchar(16);
--> statement-breakpoint
ALTER TABLE "public"."personal_expenses"
  DROP CONSTRAINT IF EXISTS "personal_expenses_purpose_check";
--> statement-breakpoint
ALTER TABLE "public"."personal_expenses"
  ADD CONSTRAINT "personal_expenses_purpose_check"
  CHECK ("purpose" IS NULL OR "purpose" IN ('fixed', 'flexible', 'emergency'));
--> statement-breakpoint
-- The daily flag becomes kind-aware at insert time. 0095 created it
-- `NOT NULL DEFAULT true`; the column default would silently mark a new income
-- row as daily spending before the fill trigger could see the omitted value.
ALTER TABLE "public"."personal_expenses"
  ALTER COLUMN "counts_in_daily" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "public"."personal_expenses"
  DROP CONSTRAINT IF EXISTS "personal_expenses_kind_shape_check";
--> statement-breakpoint
ALTER TABLE "public"."personal_expenses"
  ADD CONSTRAINT "personal_expenses_kind_shape_check"
  CHECK (
    (
      "kind" = 'expense'
      AND "direction" = 'out'
      AND "category" IS NOT NULL
      AND "need_vs_want" IS NOT NULL
    )
    OR (
      "kind" IN ('income', 'opening')
      AND "direction" = 'in'
      AND "category" IS NULL
      AND "need_vs_want" IS NULL
      AND "purpose" IS NULL
    )
    OR (
      "kind" = 'savings_transfer'
      AND "direction" = 'out'
      AND "category" IS NULL
      AND "need_vs_want" IS NULL
      AND "purpose" IS NULL
    )
    OR (
      "kind" = 'reconciliation_adjustment'
      AND "direction" IN ('in', 'out')
      AND "category" IS NULL
      AND "need_vs_want" IS NULL
      AND "purpose" IS NULL
    )
  );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "personal_expenses_owner_booking_date_idx"
  ON "public"."personal_expenses" USING btree ("owner_user_id", "booking_date" DESC, "id" DESC);
--> statement-breakpoint
-- Fill trigger for a new movement insert. It never overrides an explicit value
-- and never replaces 0095's booking-date derivation: that trigger runs first
-- (owner-period timezone, then owner context, then the product default) and
-- this one only fills a still-missing day for a timestamped compatibility
-- client and the kind-aware daily flag.
CREATE OR REPLACE FUNCTION public.fill_personal_expense_movement_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fill$
BEGIN
  IF NEW."counts_in_daily" IS NULL THEN
    NEW."counts_in_daily" := (NEW."kind" = 'expense');
  END IF;

  IF NEW."booking_date" IS NULL THEN
    NEW."booking_date" := (NEW."occurred_at" AT TIME ZONE 'UTC')::date;
  END IF;
  RETURN NEW;
END
$fill$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "personal_expenses_fill_movement_fields" ON "public"."personal_expenses";
--> statement-breakpoint
CREATE TRIGGER "personal_expenses_fill_movement_fields"
  BEFORE INSERT ON "public"."personal_expenses"
  FOR EACH ROW
  EXECUTE FUNCTION public.fill_personal_expense_movement_fields();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.fill_personal_expense_movement_fields() FROM PUBLIC;
--> statement-breakpoint
GRANT UPDATE (
  "booking_date",
  "purpose",
  "counts_in_daily"
) ON TABLE "public"."personal_expenses" TO authenticated;

-- MONEY-04: record income and savings movements in one ledger.
--
-- The personal_expenses journal becomes the canonical money ledger. This is
-- additive: existing expenses keep their ids, amounts, versions, soft-delete
-- history and idempotency receipts. No second ledger and no second opening
-- owner are introduced; `opening` is the kind MONEY-03 period initialization
-- writes (see 0095_money_03_periods).
--
-- Defaults:
--   * kind='expense', direction='out' for the backfill, so an existing expense
--     retains its recorded-spending meaning.
--   * counts_in_daily backfills true for existing expenses. New inserts that
--     omit the flag get the contract default by kind (expense true; opening,
--     income, savings transfer and reconciliation adjustment false) through the
--     fill trigger below, so a writer cannot accidentally mark income as daily
--     spending by omission. An explicit value always persists.
--   * Non-expense rows carry no fictional category or need/want value: those
--     columns become nullable and the coherence check below enforces the kind.
--   * `booking_date` is an owner-local calendar day. Existing rows are
--     backfilled from `occurred_at` in the owner's configured timezone (UTC
--     when none is configured); imported Ledger J values will be reconciled by
--     MONEY-13 rather than guessed here.
--
-- Money period context (`period_id`) is owned by MONEY-03. The foreign key is
-- added only when `money_periods` exists so this file can be applied on a base
-- that has not yet merged 0095; the serial coordinator applies 0095 first.

ALTER TABLE "public"."personal_expenses"
  ADD COLUMN IF NOT EXISTS "kind" varchar(32) NOT NULL DEFAULT 'expense',
  ADD COLUMN IF NOT EXISTS "direction" varchar(3) NOT NULL DEFAULT 'out',
  ADD COLUMN IF NOT EXISTS "purpose" varchar(16),
  ADD COLUMN IF NOT EXISTS "counts_in_daily" boolean,
  ADD COLUMN IF NOT EXISTS "booking_date" date,
  ADD COLUMN IF NOT EXISTS "period_id" uuid;
--> statement-breakpoint
UPDATE "public"."personal_expenses" AS e
SET "counts_in_daily" = true
WHERE e."counts_in_daily" IS NULL;
--> statement-breakpoint
ALTER TABLE "public"."personal_expenses"
  ALTER COLUMN "counts_in_daily" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "public"."personal_expenses"
  ALTER COLUMN "category" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "public"."personal_expenses"
  ALTER COLUMN "need_vs_want" DROP NOT NULL;
--> statement-breakpoint
UPDATE "public"."personal_expenses" AS e
SET "booking_date" = (
  e."occurred_at" AT TIME ZONE COALESCE(
    (
      SELECT tc."iana_timezone"
      FROM "public"."user_time_context" AS tc
      JOIN pg_timezone_names AS tz ON tz."name" = tc."iana_timezone"
      WHERE tc."user_id" = e."owner_user_id"
    ),
    'UTC'
  )
)::date
WHERE e."booking_date" IS NULL;
--> statement-breakpoint
ALTER TABLE "public"."personal_expenses"
  ALTER COLUMN "booking_date" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "public"."personal_expenses"
  DROP CONSTRAINT IF EXISTS "personal_expenses_category_check";
--> statement-breakpoint
ALTER TABLE "public"."personal_expenses"
  ADD CONSTRAINT "personal_expenses_category_check"
  CHECK (
    "category" IS NULL
    OR "category" IN ('coffee', 'groceries', 'eating_out', 'transport', 'bills', 'subscriptions', 'household', 'health', 'other')
  );
--> statement-breakpoint
ALTER TABLE "public"."personal_expenses"
  DROP CONSTRAINT IF EXISTS "personal_expenses_need_vs_want_check";
--> statement-breakpoint
ALTER TABLE "public"."personal_expenses"
  ADD CONSTRAINT "personal_expenses_need_vs_want_check"
  CHECK ("need_vs_want" IS NULL OR "need_vs_want" IN ('need', 'want'));
--> statement-breakpoint
ALTER TABLE "public"."personal_expenses"
  DROP CONSTRAINT IF EXISTS "personal_expenses_kind_check";
--> statement-breakpoint
ALTER TABLE "public"."personal_expenses"
  ADD CONSTRAINT "personal_expenses_kind_check"
  CHECK ("kind" IN ('expense', 'income', 'opening', 'savings_transfer', 'reconciliation_adjustment'));
--> statement-breakpoint
ALTER TABLE "public"."personal_expenses"
  DROP CONSTRAINT IF EXISTS "personal_expenses_direction_check";
--> statement-breakpoint
ALTER TABLE "public"."personal_expenses"
  ADD CONSTRAINT "personal_expenses_direction_check"
  CHECK ("direction" IN ('in', 'out'));
--> statement-breakpoint
ALTER TABLE "public"."personal_expenses"
  DROP CONSTRAINT IF EXISTS "personal_expenses_purpose_check";
--> statement-breakpoint
ALTER TABLE "public"."personal_expenses"
  ADD CONSTRAINT "personal_expenses_purpose_check"
  CHECK ("purpose" IS NULL OR "purpose" IN ('fixed', 'flexible', 'emergency'));
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
DO $period_fk$
BEGIN
  IF to_regclass('public.money_periods') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'personal_expenses_period_id_fkey'
     )
  THEN
    ALTER TABLE "public"."personal_expenses"
      ADD CONSTRAINT "personal_expenses_period_id_fkey"
      FOREIGN KEY ("period_id") REFERENCES "public"."money_periods"("id")
      ON DELETE SET NULL;
  END IF;
END
$period_fk$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.fill_personal_expense_movement_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fill$
BEGIN
  IF NEW."counts_in_daily" IS NULL THEN
    -- Contract default by kind; an explicit caller value always wins.
    NEW."counts_in_daily" := (NEW."kind" = 'expense');
  END IF;

  IF NEW."booking_date" IS NULL THEN
    -- Compatibility for a timestamped legacy client that does not send a
    -- booking day. New movement writes always supply the owner-local date.
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
CREATE OR REPLACE FUNCTION public.enforce_personal_expense_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $guard$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.direction IS DISTINCT FROM OLD.direction
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
GRANT UPDATE (
  "booking_date",
  "purpose",
  "counts_in_daily"
) ON TABLE "public"."personal_expenses" TO authenticated;

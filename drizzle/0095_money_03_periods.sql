-- MONEY-03: configure a money period, opening cash and active date.
--
-- Baseline: 0093 is the journal tail. This migration is additive and never
-- rewrites an applied migration or an existing expense id/value/version.
--
-- What changes:
--   1. `personal_expenses` becomes the single ledger for the first extra
--      movement kind, `opening`:
--        * new `kind`, `direction`, `booking_date`, `counts_in_daily`,
--          `period_id` columns;
--        * non-expense rows keep category/need-vs-want null and never invent
--          payment metadata;
--        * only the `opening` kind may be zero; every other amount stays
--          positive integer centimes;
--        * `occurred_at` becomes nullable so a date-only opening does not
--          claim a fabricated purchase instant. Existing timestamped rows keep
--          their exact values and are never rewritten.
--   2. Legacy booking dates are assigned deterministically from `occurred_at`
--      in the owner's stored IANA timezone, falling back to the Money product
--      default `Africa/Casablanca` when the owner has no valid context. The
--      assignment is reviewable SQL; no period is invented and no opening is
--      created for an existing expense-only account.
--   3. New `public.money_periods` owns inclusive period state: one tracking
--      period per owner, lifecycle, initialization, the single opening
--      movement reference, provenance, settings and version.
--   4. `personal_expenses(owner_user_id, period_id)` is unique for the opening
--      kind, so one period can never hold a second independently editable
--      opening amount.
--   5. RLS mirrors the MONEY-01 grant rule: direct users keep owner-scoped
--      access; OAuth/MCP access needs the matching active read/write grant.
--      There is no DELETE grant or policy, and no service-role path.
--   6. Two security-invoker RPCs make period+opening writes atomic:
--      `money_create_period` and `money_update_period`. They take the owner
--      from `auth.uid()`, never from a parameter, and are the only supported
--      multi-row write path.
--
-- Extension seam: MONEY-04/05 add income, savings and purpose columns/checks
-- without changing the opening invariant or this table's identity.

-- 1. Additive ledger columns ---------------------------------------------------
ALTER TABLE public.personal_expenses
  ADD COLUMN IF NOT EXISTS "kind" varchar(32) NOT NULL DEFAULT 'expense',
  ADD COLUMN IF NOT EXISTS "direction" varchar(8) NOT NULL DEFAULT 'out',
  ADD COLUMN IF NOT EXISTS "booking_date" date,
  ADD COLUMN IF NOT EXISTS "counts_in_daily" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "period_id" uuid;
--> statement-breakpoint
-- The 0088 update guard requires version+1 on every UPDATE. Legacy rows must
-- keep their exact version and values, so the guard is removed for this
-- one-time additive backfill and recreated (extended) later in this migration.
DROP TRIGGER IF EXISTS "personal_expenses_update_guard" ON "public"."personal_expenses";
--> statement-breakpoint
UPDATE public.personal_expenses
SET "kind" = 'expense',
    "direction" = 'out',
    "counts_in_daily" = true
WHERE "kind" IS DISTINCT FROM 'expense'
   OR "direction" IS DISTINCT FROM 'out';
--> statement-breakpoint
-- Deterministic, reviewable legacy booking-date assignment. The owner's stored
-- IANA zone wins; an absent/invalid zone uses the Money product default rather
-- than assuming the workbook's Etc/GMT. Existing occurred_at values are never
-- changed.
UPDATE public.personal_expenses AS expense
SET "booking_date" = (
  expense."occurred_at" AT TIME ZONE COALESCE(
    (
      SELECT zone."iana_timezone"
      FROM public.user_time_context AS zone
      WHERE zone."user_id" = expense."owner_user_id"
        AND EXISTS (
          SELECT 1
          FROM pg_timezone_names AS timezone_name
          WHERE timezone_name."name" = zone."iana_timezone"
        )
      LIMIT 1
    ),
    'Africa/Casablanca'
  )
)::date
WHERE expense."booking_date" IS NULL
  AND expense."occurred_at" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.personal_expenses
  ALTER COLUMN "occurred_at" DROP NOT NULL,
  ALTER COLUMN "category" DROP NOT NULL,
  ALTER COLUMN "need_vs_want" DROP NOT NULL,
  ALTER COLUMN "booking_date" SET NOT NULL;
--> statement-breakpoint
-- Restore the 0088 guard immediately after the one-time backfill. Section 4
-- replaces the function with the extended kind/opening rules without ever
-- leaving the table unguarded beyond this transaction.
DROP TRIGGER IF EXISTS "personal_expenses_update_guard" ON "public"."personal_expenses";
CREATE TRIGGER "personal_expenses_update_guard"
  BEFORE UPDATE ON "public"."personal_expenses"
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_personal_expense_update();
--> statement-breakpoint
ALTER TABLE public.personal_expenses
  DROP CONSTRAINT IF EXISTS "personal_expenses_amount_minor_check";
--> statement-breakpoint
ALTER TABLE public.personal_expenses
  ADD CONSTRAINT "personal_expenses_amount_minor_check"
  CHECK (
    "amount_minor" <= 2147483647
    AND (
      ("kind" = 'opening' AND "amount_minor" >= 0)
      OR ("kind" <> 'opening' AND "amount_minor" >= 1)
    )
  );
--> statement-breakpoint
ALTER TABLE public.personal_expenses
  ADD CONSTRAINT "personal_expenses_kind_check"
  CHECK ("kind" IN ('expense', 'income', 'opening', 'savings_transfer', 'reconciliation_adjustment'));
--> statement-breakpoint
ALTER TABLE public.personal_expenses
  ADD CONSTRAINT "personal_expenses_direction_check"
  CHECK ("direction" IN ('in', 'out'));
--> statement-breakpoint
ALTER TABLE public.personal_expenses
  ADD CONSTRAINT "personal_expenses_kind_direction_check"
  CHECK (
    ("kind" <> 'opening' OR "direction" = 'in')
    AND ("kind" <> 'expense' OR "direction" = 'out')
  );
--> statement-breakpoint
ALTER TABLE public.personal_expenses
  ADD CONSTRAINT "personal_expenses_non_expense_metadata_check"
  CHECK (
    ("kind" = 'expense' AND "category" IS NOT NULL AND "need_vs_want" IS NOT NULL)
    OR ("kind" <> 'expense' AND "category" IS NULL AND "need_vs_want" IS NULL AND "payment_method" IS NULL)
  );
--> statement-breakpoint
ALTER TABLE public.personal_expenses
  ADD CONSTRAINT "personal_expenses_opening_period_check"
  CHECK ("kind" <> 'opening' OR "period_id" IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "personal_expenses_owner_period_opening_unique"
  ON "public"."personal_expenses" USING btree ("owner_user_id", "period_id")
  WHERE "kind" = 'opening';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "personal_expenses_owner_booking_date_idx"
  ON "public"."personal_expenses" USING btree ("owner_user_id", "booking_date" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "personal_expenses_owner_period_idx"
  ON "public"."personal_expenses" USING btree ("owner_user_id", "period_id", "booking_date");

-- 2. Period state --------------------------------------------------------------
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."money_periods" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_user_id" uuid DEFAULT auth.uid() NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "currency" varchar(3) DEFAULT 'MAD' NOT NULL,
  "timezone" varchar(128) NOT NULL,
  "active_date" date NOT NULL,
  "lifecycle" varchar(16) DEFAULT 'tracking' NOT NULL,
  "initialization" varchar(16) DEFAULT 'uninitialized' NOT NULL,
  "opening_movement_id" uuid,
  "provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "money_periods_range_check" CHECK ("start_date" <= "end_date"),
  CONSTRAINT "money_periods_currency_check" CHECK ("currency" = 'MAD'),
  CONSTRAINT "money_periods_active_date_check" CHECK ("active_date" >= "start_date" AND "active_date" <= "end_date"),
  CONSTRAINT "money_periods_timezone_check" CHECK (btrim("timezone") <> ''),
  CONSTRAINT "money_periods_lifecycle_check" CHECK ("lifecycle" IN ('tracking', 'ended', 'rolled_over')),
  CONSTRAINT "money_periods_initialization_check" CHECK ("initialization" IN ('uninitialized', 'initialized', 'reconciled')),
  CONSTRAINT "money_periods_version_check" CHECK ("version" > 0),
  CONSTRAINT "money_periods_provenance_object_check" CHECK (jsonb_typeof("provenance") = 'object'),
  CONSTRAINT "money_periods_settings_object_check" CHECK (jsonb_typeof("settings") = 'object'),
  CONSTRAINT "money_periods_opening_consistency_check" CHECK (
    ("initialization" = 'uninitialized' AND "opening_movement_id" IS NULL)
    OR ("initialization" IN ('initialized', 'reconciled') AND "opening_movement_id" IS NOT NULL)
  ),
  CONSTRAINT "money_periods_initialization_evidence_check" CHECK (
    "initialization" = 'uninitialized'
    OR (
      "initialization" = 'initialized'
      AND ("provenance" #>> '{opening,source}') IN ('user_entered', 'carry_forward')
    )
    OR (
      "initialization" = 'reconciled'
      AND ("provenance" #>> '{opening,source}') = 'verified_source'
      AND NULLIF(btrim(COALESCE("provenance" #>> '{opening,evidence}', '')), '') IS NOT NULL
      AND NULLIF(btrim(COALESCE("provenance" #>> '{opening,cutoffDate}', '')), '') IS NOT NULL
    )
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "money_periods_owner_tracking_unique"
  ON "public"."money_periods" USING btree ("owner_user_id")
  WHERE "lifecycle" = 'tracking';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "money_periods_owner_range_unique"
  ON "public"."money_periods" USING btree ("owner_user_id", "start_date", "end_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "money_periods_owner_history_idx"
  ON "public"."money_periods" USING btree ("owner_user_id", "end_date" DESC, "start_date" DESC);
--> statement-breakpoint
ALTER TABLE public.money_periods ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.money_periods FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "money_periods_direct_user_select" ON "public"."money_periods";
CREATE POLICY "money_periods_direct_user_select" ON "public"."money_periods"
  FOR SELECT TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.read')
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "money_periods_direct_user_insert" ON "public"."money_periods";
CREATE POLICY "money_periods_direct_user_insert" ON "public"."money_periods"
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.write')
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "money_periods_direct_user_update" ON "public"."money_periods";
CREATE POLICY "money_periods_direct_user_update" ON "public"."money_periods"
  FOR UPDATE TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.write')
    )
  )
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.write')
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "money_periods_direct_user_delete" ON "public"."money_periods";
--> statement-breakpoint
REVOKE ALL ON TABLE "public"."money_periods" FROM anon;
--> statement-breakpoint
REVOKE ALL ON TABLE "public"."money_periods" FROM authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE "public"."money_periods" TO authenticated;
--> statement-breakpoint
GRANT INSERT ON TABLE "public"."money_periods" TO authenticated;
--> statement-breakpoint
GRANT UPDATE (
  "active_date",
  "lifecycle",
  "initialization",
  "opening_movement_id",
  "provenance",
  "settings",
  "version",
  "updated_at"
) ON TABLE "public"."money_periods" TO authenticated;

-- 3. Foreign keys (created after both tables exist) ----------------------------
--> statement-breakpoint
ALTER TABLE public.personal_expenses
  ADD CONSTRAINT "personal_expenses_period_id_fkey"
  FOREIGN KEY ("period_id") REFERENCES public.money_periods("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE public.money_periods
  ADD CONSTRAINT "money_periods_opening_movement_id_fkey"
  FOREIGN KEY ("opening_movement_id") REFERENCES public.personal_expenses("id") ON DELETE RESTRICT;

-- 4. Booking-date derivation and opening integrity -----------------------------
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.set_personal_expense_booking_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $booking_date$
DECLARE
  v_timezone text;
BEGIN
  -- Recompute when a timestamped booking is (re)written: a changed instant
  -- must not keep the old derived day. A date-only row keeps its explicit date.
  IF NEW."occurred_at" IS NOT NULL
     AND (
       NEW."booking_date" IS NULL
       OR (TG_OP = 'UPDATE' AND NEW."occurred_at" IS DISTINCT FROM OLD."occurred_at")
     ) THEN
    -- The period's configured timezone is the single entry/booking authority
    -- when the movement belongs to a period; owner context is the fallback.
    IF NEW."period_id" IS NOT NULL THEN
      SELECT NULLIF(btrim(period."timezone"), '')
        INTO v_timezone
        FROM public.money_periods AS period
        WHERE period."id" = NEW."period_id"
          AND period."owner_user_id" = NEW."owner_user_id";
    END IF;

    IF v_timezone IS NULL THEN
      SELECT NULLIF(btrim(zone."iana_timezone"), '')
        INTO v_timezone
        FROM public.user_time_context AS zone
        WHERE zone."user_id" = NEW."owner_user_id"
        LIMIT 1;
    END IF;

    IF v_timezone IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM pg_timezone_names AS timezone_name WHERE timezone_name."name" = v_timezone
       ) THEN
      v_timezone := 'Africa/Casablanca';
    END IF;

    NEW."booking_date" := (NEW."occurred_at" AT TIME ZONE v_timezone)::date;
  END IF;
  RETURN NEW;
END
$booking_date$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "personal_expenses_booking_date_trigger" ON "public"."personal_expenses";
CREATE TRIGGER "personal_expenses_booking_date_trigger"
  BEFORE INSERT OR UPDATE ON "public"."personal_expenses"
  FOR EACH ROW
  EXECUTE FUNCTION public.set_personal_expense_booking_date();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_personal_expense_opening()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $opening$
DECLARE
  v_start_date date;
  v_period_owner uuid;
BEGIN
  IF NEW."period_id" IS NOT NULL THEN
    SELECT period."start_date", period."owner_user_id"
      INTO v_start_date, v_period_owner
      FROM public.money_periods AS period
      WHERE period."id" = NEW."period_id";
    IF NOT FOUND OR v_period_owner IS DISTINCT FROM NEW."owner_user_id" THEN
      RAISE EXCEPTION 'An expense period must belong to the same owner.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."kind" = 'opening' THEN
    IF NEW."period_id" IS NULL THEN
      RAISE EXCEPTION 'An opening movement must reference its period.'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."booking_date" IS DISTINCT FROM v_start_date THEN
      RAISE EXCEPTION 'An opening movement books on the period start date.'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."occurred_at" IS NOT NULL THEN
      RAISE EXCEPTION 'An opening movement is date-only and must not claim an instant.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END
$opening$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "personal_expenses_opening_guard" ON "public"."personal_expenses";
CREATE TRIGGER "personal_expenses_opening_guard"
  BEFORE INSERT OR UPDATE ON "public"."personal_expenses"
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_personal_expense_opening();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_personal_expense_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $guard$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
     OR NEW."create_fingerprint" IS DISTINCT FROM OLD."create_fingerprint"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."direction" IS DISTINCT FROM OLD."direction"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'Immutable expense fields cannot be changed.'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."kind" = 'opening' THEN
    IF NEW."deleted_at" IS NOT NULL THEN
      RAISE EXCEPTION 'An opening movement cannot be deleted; correct it instead.'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."period_id" IS DISTINCT FROM OLD."period_id"
       OR NEW."booking_date" IS DISTINCT FROM OLD."booking_date" THEN
      RAISE EXCEPTION 'An opening movement stays on its period start date.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF OLD."deleted_at" IS NOT NULL THEN
    RAISE EXCEPTION 'A deleted expense cannot be modified or restored.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."version" IS DISTINCT FROM OLD."version" + 1 THEN
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

-- 5. Period state guard --------------------------------------------------------
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_money_period_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $period_guard$
DECLARE
  v_opening_kind text;
  v_opening_owner uuid;
  v_opening_period uuid;
  v_opening_deleted timestamptz;
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id"
     OR NEW."start_date" IS DISTINCT FROM OLD."start_date"
     OR NEW."end_date" IS DISTINCT FROM OLD."end_date"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."timezone" IS DISTINCT FROM OLD."timezone"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'Period identity, boundaries, currency and timezone are immutable.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."version" IS DISTINCT FROM OLD."version" + 1 THEN
    RAISE EXCEPTION 'Period version must increase by exactly one.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (OLD."lifecycle" = 'tracking' AND NEW."lifecycle" IN ('tracking', 'ended', 'rolled_over'))
    OR (OLD."lifecycle" = 'ended' AND NEW."lifecycle" IN ('ended', 'rolled_over'))
    OR (OLD."lifecycle" = 'rolled_over' AND NEW."lifecycle" = 'rolled_over')
  ) THEN
    RAISE EXCEPTION 'Period lifecycle cannot move backwards.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (OLD."initialization" = 'uninitialized' AND NEW."initialization" IN ('uninitialized', 'initialized', 'reconciled'))
    OR (OLD."initialization" = 'initialized' AND NEW."initialization" IN ('initialized', 'reconciled'))
    OR (OLD."initialization" = 'reconciled' AND NEW."initialization" = 'reconciled')
  ) THEN
    RAISE EXCEPTION 'Period initialization cannot lose recorded evidence.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."opening_movement_id" IS NOT NULL THEN
    SELECT movement."kind", movement."owner_user_id", movement."period_id", movement."deleted_at"
      INTO v_opening_kind, v_opening_owner, v_opening_period, v_opening_deleted
      FROM public.personal_expenses AS movement
      WHERE movement."id" = NEW."opening_movement_id";

    IF NOT FOUND
       OR v_opening_kind IS DISTINCT FROM 'opening'
       OR v_opening_owner IS DISTINCT FROM NEW."owner_user_id"
       OR v_opening_period IS DISTINCT FROM NEW."id"
       OR v_opening_deleted IS NOT NULL THEN
      RAISE EXCEPTION 'The period opening reference is invalid.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END
$period_guard$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "money_periods_update_guard" ON "public"."money_periods";
CREATE TRIGGER "money_periods_update_guard"
  BEFORE UPDATE ON "public"."money_periods"
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_money_period_update();

-- 6. Atomic write primitives ---------------------------------------------------
-- The RPCs are SECURITY INVOKER: RLS still applies to every statement. Owner
-- identity always comes from auth.uid(); no parameter can select an owner.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.money_create_period(
  p_start_date date,
  p_end_date date,
  p_timezone text,
  p_active_date date,
  p_initialization text,
  p_opening_amount_minor integer,
  p_opening_booking_date date,
  p_opening_create_fingerprint text,
  p_provenance jsonb,
  p_settings jsonb,
  p_created_at timestamp with time zone
)
RETURNS public.money_periods
LANGUAGE plpgsql
SET search_path = ''
AS $create_period$
DECLARE
  v_owner uuid := auth.uid();
  v_period_id uuid := gen_random_uuid();
  v_opening_id uuid;
  v_period public.money_periods;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.money_periods (
    "id", "owner_user_id", "start_date", "end_date", "currency", "timezone",
    "active_date", "lifecycle", "initialization", "opening_movement_id",
    "provenance", "settings", "version", "created_at", "updated_at"
  ) VALUES (
    v_period_id, v_owner, p_start_date, p_end_date, 'MAD', p_timezone,
    p_active_date, 'tracking', 'uninitialized', NULL,
    p_provenance, p_settings, 1, p_created_at, p_created_at
  );

  IF p_opening_amount_minor IS NOT NULL THEN
    INSERT INTO public.personal_expenses (
      "owner_user_id", "occurred_at", "amount_minor", "currency",
      "category", "note", "merchant", "need_vs_want", "payment_method",
      "idempotency_key", "create_fingerprint", "kind", "direction",
      "booking_date", "counts_in_daily", "period_id", "created_at", "updated_at"
    ) VALUES (
      v_owner, NULL, p_opening_amount_minor, 'MAD',
      NULL, NULL, NULL, NULL, NULL,
      'opening:' || v_period_id, p_opening_create_fingerprint, 'opening', 'in',
      p_opening_booking_date, false, v_period_id, p_created_at, p_created_at
    )
    RETURNING "id" INTO v_opening_id;

    UPDATE public.money_periods
    SET "initialization" = p_initialization,
        "opening_movement_id" = v_opening_id,
        "provenance" = p_provenance,
        "version" = "version" + 1,
        "updated_at" = p_created_at
    WHERE "id" = v_period_id
      AND "owner_user_id" = v_owner
    RETURNING * INTO v_period;
  ELSE
    SELECT * INTO v_period
    FROM public.money_periods
    WHERE "id" = v_period_id AND "owner_user_id" = v_owner;
  END IF;

  RETURN v_period;
END
$create_period$;
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.money_update_period(
  uuid, integer, date, jsonb, integer, text, text, jsonb, text, timestamp with time zone
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.money_update_period(
  p_period_id uuid,
  p_expected_version integer,
  p_active_date date,
  p_settings jsonb,
  p_opening_amount_minor integer,
  p_opening_create_fingerprint text,
  p_opening_note text,
  p_provenance jsonb,
  p_initialization text,
  p_updated_at timestamp with time zone
)
RETURNS SETOF public.money_periods
LANGUAGE plpgsql
SET search_path = ''
AS $update_period$
DECLARE
  v_owner uuid := auth.uid();
  v_period public.money_periods;
  v_opening public.personal_expenses;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_period
  FROM public.money_periods
  WHERE "id" = p_period_id AND "owner_user_id" = v_owner
  FOR UPDATE;

  IF NOT FOUND OR v_period."version" <> p_expected_version THEN
    RETURN;
  END IF;

  IF v_period."lifecycle" <> 'tracking' THEN
    RAISE EXCEPTION 'Only a tracking period accepts routine settings changes.'
      USING ERRCODE = '23514';
  END IF;

  IF p_opening_amount_minor IS NOT NULL THEN
    IF p_initialization IS NULL OR p_provenance IS NULL THEN
      RAISE EXCEPTION 'Opening updates require initialization and provenance.'
        USING ERRCODE = '23514';
    END IF;

    IF v_period."opening_movement_id" IS NULL THEN
      INSERT INTO public.personal_expenses (
        "owner_user_id", "occurred_at", "amount_minor", "currency",
        "category", "note", "merchant", "need_vs_want", "payment_method",
        "idempotency_key", "create_fingerprint", "kind", "direction",
        "booking_date", "counts_in_daily", "period_id", "created_at", "updated_at"
      ) VALUES (
        v_owner, NULL, p_opening_amount_minor, 'MAD',
        NULL, p_opening_note, NULL, NULL, NULL,
        'opening:' || v_period."id", p_opening_create_fingerprint, 'opening', 'in',
        v_period."start_date", false, v_period."id", p_updated_at, p_updated_at
      )
      RETURNING * INTO v_opening;
    ELSE
      UPDATE public.personal_expenses
      SET "amount_minor" = p_opening_amount_minor,
          "note" = p_opening_note,
          "version" = "version" + 1,
          "updated_at" = p_updated_at
      WHERE "id" = v_period."opening_movement_id"
        AND "owner_user_id" = v_owner
        AND "kind" = 'opening'
        AND "deleted_at" IS NULL
      RETURNING * INTO v_opening;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'The period opening movement is missing or not owned.'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    UPDATE public.money_periods
    SET "active_date" = COALESCE(p_active_date, "active_date"),
        "settings" = COALESCE(p_settings, "settings"),
        "initialization" = p_initialization,
        "opening_movement_id" = v_opening."id",
        "provenance" = p_provenance,
        "version" = "version" + 1,
        "updated_at" = p_updated_at
    WHERE "id" = p_period_id AND "owner_user_id" = v_owner
    RETURNING * INTO v_period;
  ELSE
    UPDATE public.money_periods
    SET "active_date" = COALESCE(p_active_date, "active_date"),
        "settings" = COALESCE(p_settings, "settings"),
        "version" = "version" + 1,
        "updated_at" = p_updated_at
    WHERE "id" = p_period_id AND "owner_user_id" = v_owner
    RETURNING * INTO v_period;
  END IF;

  RETURN NEXT v_period;
  RETURN;
END
$update_period$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.set_personal_expense_booking_date() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_personal_expense_opening() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_personal_expense_update() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_money_period_update() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_create_period(
  date, date, text, date, text, integer, date, text, jsonb, jsonb, timestamp with time zone
) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_create_period(
  date, date, text, date, text, integer, date, text, jsonb, jsonb, timestamp with time zone
) FROM anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.money_create_period(
  date, date, text, date, text, integer, date, text, jsonb, jsonb, timestamp with time zone
) TO authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_update_period(
  uuid, integer, date, jsonb, integer, text, text, jsonb, text, timestamp with time zone
) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_update_period(
  uuid, integer, date, jsonb, integer, text, text, jsonb, text, timestamp with time zone
) FROM anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.money_update_period(
  uuid, integer, date, jsonb, integer, text, text, jsonb, text, timestamp with time zone
) TO authenticated;

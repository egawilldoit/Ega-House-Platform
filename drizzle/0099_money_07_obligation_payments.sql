-- MONEY-07: atomic obligation payment, correction and undo.
--
-- Baseline: 0098 (MONEY-06) owns obligation occurrences, the linked-payment
-- guard and the explicit lifecycle. This migration is additive and ordered with
-- `when` 1787880000062, so it applies after 0098. No applied migration is
-- edited; the 0098 guard functions are replaced in place here with
-- CREATE OR REPLACE, which keeps one canonical definition.
--
-- What this adds:
--   1. `money_obligations.payment_operation_id` — the operation that recorded
--      the payment. A retry of the same operation replays the original result
--      instead of paying twice, and a different operation cannot pay an
--      already-paid occurrence. The unique index below makes one operation
--      settle at most one occurrence.
--   2. `money_obligations.payment_revision_operation_id` — the operation of the
--      most recent correction or undo, so those writes are replay-safe too.
--   3. Three SECURITY DEFINER RPCs that own the whole write:
--        * `money_pay_obligation` inserts exactly one canonical
--          `personal_expenses` outflow and links the occurrence in the same
--          transaction;
--        * `money_correct_obligation_payment` moves the linked payment and the
--          occurrence together, keeping full-payment equality;
--        * `money_undo_obligation_payment` soft-deletes the linked payment and
--          reopens the occurrence in the same transaction.
--      The owner is always `auth.uid()`; no parameter can select an owner, and
--      an OAuth client still needs the explicit `personal_ops.write` grant.
--   4. A transaction-local flag `ega.money_obligation_payment_path` that only
--      these three RPCs set. The 0098 linked-payment guard and the occurrence
--      update guard keep refusing generic expense edits of a linked payment;
--      they accept the correction path only while that flag is on.
--   5. Deferred coherence checks. At commit, a paid occurrence must still have
--      exactly one linked, undeleted, same-owner MAD expense outflow worth
--      exactly the occurrence amount, and a linked payment must not be deleted
--      or re-priced behind the occurrence's back. The backstop covers identity,
--      owner, kind/direction, amount, currency and deletion. It is defense in
--      depth, not a substitute for the flag: raw SQL that forges the
--      backend-local flag can still move non-mirrored classification fields,
--      so the flag must remain transaction-local and is not exposed as an RPC.
--      PostgREST exposes no set_config surface; direct database roles are the
--      only channel that could forge it.
-->
--> statement-breakpoint
ALTER TABLE "public"."money_obligations"
  ADD COLUMN IF NOT EXISTS "payment_operation_id" varchar(128);
--> statement-breakpoint
ALTER TABLE "public"."money_obligations"
  ADD COLUMN IF NOT EXISTS "payment_revision_operation_id" varchar(128);
--> statement-breakpoint
ALTER TABLE "public"."money_obligations"
  DROP CONSTRAINT IF EXISTS "money_obligations_payment_operation_check";
--> statement-breakpoint
ALTER TABLE "public"."money_obligations"
  ADD CONSTRAINT "money_obligations_payment_operation_check"
  CHECK (
    ("payment_operation_id" IS NULL OR "payment_expense_id" IS NOT NULL)
    AND ("payment_operation_id" IS NULL OR "state" = 'paid')
  );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "money_obligations_owner_payment_operation_unique"
  ON "public"."money_obligations" USING btree ("owner_user_id", "payment_operation_id")
  WHERE "payment_operation_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "money_obligations_owner_payment_revision_idx"
  ON "public"."money_obligations" USING btree ("owner_user_id", "payment_revision_operation_id")
  WHERE "payment_revision_operation_id" IS NOT NULL;
--> statement-breakpoint
-- The transaction-local payment-path flag. Only the three RPCs below set it,
-- with `set_config(..., true)`, so it never survives the transaction.
CREATE OR REPLACE FUNCTION public.money_obligation_payment_path_active()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT COALESCE(current_setting('ega.money_obligation_payment_path', true) = 'on', false);
$function$;
--> statement-breakpoint
-- The 0098 linked-payment guard, unchanged except that the correction/undo
-- path is accepted while the transaction-local payment flag is on. A generic
-- expense edit or soft delete of a linked payment is still refused.
CREATE OR REPLACE FUNCTION public.enforce_linked_obligation_payment_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $guard$
BEGIN
  IF (
    NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
    OR NEW.booking_date IS DISTINCT FROM OLD.booking_date
    OR NEW.purpose IS DISTINCT FROM OLD.purpose
    OR NEW.counts_in_daily IS DISTINCT FROM OLD.counts_in_daily
    OR NEW.category IS DISTINCT FROM OLD.category
    OR NEW.need_vs_want IS DISTINCT FROM OLD.need_vs_want
    OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  ) AND EXISTS (
    SELECT 1
    FROM public.money_obligations AS obligation
    WHERE obligation.payment_expense_id = OLD.id
      AND obligation.state = 'paid'
  ) THEN
    IF NOT public.money_obligation_payment_path_active() THEN
      RAISE EXCEPTION 'A ledger payment linked to a paid obligation cannot be edited or deleted; correct the obligation through the MONEY-07 payment path first.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END
$guard$;
--> statement-breakpoint
-- The 0098 occurrence update guard, unchanged except that a paid occurrence's
-- settlement fields (amount, need/want, purpose, daily flag, category) may
-- move while the transaction-local payment flag is on: the MONEY-07 correction
-- path keeps the payment and the occurrence in step inside one transaction.
CREATE OR REPLACE FUNCTION public.enforce_money_obligation_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $guard$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR NEW.template_id IS DISTINCT FROM OLD.template_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.create_fingerprint IS DISTINCT FROM OLD.create_fingerprint
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Immutable obligation occurrence fields cannot be changed.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
    RAISE EXCEPTION 'Obligation version must increase by exactly one.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NOT (
      (OLD.state = 'pending' AND NEW.state IN ('paid', 'waived', 'cancelled'))
      OR (OLD.state IN ('waived', 'cancelled') AND NEW.state IN ('pending', 'waived', 'cancelled'))
      OR (OLD.state = 'paid' AND NEW.state = 'pending')
    ) THEN
      RAISE EXCEPTION 'Unsupported obligation lifecycle transition from % to %.', OLD.state, NEW.state
        USING ERRCODE = '23514';
    END IF;

    IF NEW.state_effective_date < OLD.state_effective_date THEN
      RAISE EXCEPTION 'Obligation effective date cannot precede the current state date.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.state_effective_date IS DISTINCT FROM OLD.state_effective_date THEN
    RAISE EXCEPTION 'Obligation effective date changes only with a lifecycle transition.'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.state = 'paid' AND NEW.state = 'paid' THEN
    IF NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
       OR NEW.period_start IS DISTINCT FROM OLD.period_start
       OR NEW.period_end IS DISTINCT FROM OLD.period_end
       OR NEW.due_date IS DISTINCT FROM OLD.due_date
       OR NEW.need_vs_want IS DISTINCT FROM OLD.need_vs_want
       OR NEW.purpose IS DISTINCT FROM OLD.purpose
       OR NEW.counts_in_daily IS DISTINCT FROM OLD.counts_in_daily
       OR NEW.category IS DISTINCT FROM OLD.category THEN
      IF NOT public.money_obligation_payment_path_active() THEN
        RAISE EXCEPTION 'A paid obligation is settled by its linked payment; correct the payment through the MONEY-07 path.'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END
$guard$;
--> statement-breakpoint
-- The 0098 payment-link guard, unchanged except that the amount equality check
-- is deferred to the commit-time coherence check while the transaction-local
-- payment flag is on: the correction moves the payment and the occurrence in
-- one transaction, so the pair is only momentarily out of step.
CREATE OR REPLACE FUNCTION public.enforce_money_obligation_payment_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $guard$
DECLARE
  linked_owner uuid;
  linked_amount integer;
  linked_currency text;
  linked_deleted_at timestamp with time zone;
  linked_direction text;
  linked_kind text;
  template_owner uuid;
BEGIN
  IF NEW.template_id IS NOT NULL THEN
    SELECT template.owner_user_id
      INTO template_owner
      FROM public.money_obligation_templates AS template
      WHERE template.id = NEW.template_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The referenced obligation template does not exist.'
        USING ERRCODE = '23503';
    END IF;

    IF template_owner IS DISTINCT FROM NEW.owner_user_id THEN
      RAISE EXCEPTION 'The referenced obligation template belongs to a different owner.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.payment_expense_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT expense.owner_user_id, expense.amount_minor, expense.currency,
         expense.deleted_at, expense.direction, expense.kind
    INTO linked_owner, linked_amount, linked_currency, linked_deleted_at,
         linked_direction, linked_kind
    FROM public.personal_expenses AS expense
    WHERE expense.id = NEW.payment_expense_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The linked obligation payment does not exist.'
      USING ERRCODE = '23503';
  END IF;

  IF linked_owner IS DISTINCT FROM NEW.owner_user_id THEN
    RAISE EXCEPTION 'The linked obligation payment belongs to a different owner.'
      USING ERRCODE = '42501';
  END IF;

  IF linked_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'The linked obligation payment is deleted.'
      USING ERRCODE = '23514';
  END IF;

  IF linked_currency IS DISTINCT FROM 'MAD' THEN
    RAISE EXCEPTION 'The linked obligation payment must be MAD.'
      USING ERRCODE = '23514';
  END IF;

  IF linked_direction IS DISTINCT FROM 'out' OR linked_kind IS DISTINCT FROM 'expense' THEN
    RAISE EXCEPTION 'The linked obligation payment must be an expense outflow, not income, opening cash or a savings transfer.'
      USING ERRCODE = '23514';
  END IF;

  IF linked_amount IS DISTINCT FROM NEW.amount_minor
     AND NOT public.money_obligation_payment_path_active() THEN
    RAISE EXCEPTION 'An obligation payment must pay the occurrence in full; partial or overpayment is not supported.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$guard$;
--> statement-breakpoint
-- Commit-time coherence for an occurrence. The link guard only runs when the
-- link is written, so a payment that is later re-priced or deleted behind the
-- occurrence's back would otherwise go unnoticed. This deferred check closes
-- that gap for every transaction, including one that abuses the payment flag.
CREATE OR REPLACE FUNCTION public.enforce_money_obligation_payment_coherence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $coherence$
DECLARE
  linked_owner uuid;
  linked_amount integer;
  linked_currency text;
  linked_deleted_at timestamp with time zone;
  linked_direction text;
  linked_kind text;
BEGIN
  IF NEW.state <> 'paid' OR NEW.payment_expense_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT expense.owner_user_id, expense.amount_minor, expense.currency,
         expense.deleted_at, expense.direction, expense.kind
    INTO linked_owner, linked_amount, linked_currency, linked_deleted_at,
         linked_direction, linked_kind
    FROM public.personal_expenses AS expense
    WHERE expense.id = NEW.payment_expense_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A paid obligation must keep exactly one linked ledger payment.'
      USING ERRCODE = '23514';
  END IF;

  IF linked_owner IS DISTINCT FROM NEW.owner_user_id THEN
    RAISE EXCEPTION 'The linked obligation payment belongs to a different owner.'
      USING ERRCODE = '42501';
  END IF;

  IF linked_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'The linked obligation payment is deleted.'
      USING ERRCODE = '23514';
  END IF;

  IF linked_currency IS DISTINCT FROM 'MAD'
     OR linked_direction IS DISTINCT FROM 'out'
     OR linked_kind IS DISTINCT FROM 'expense' THEN
    RAISE EXCEPTION 'The linked obligation payment must be an expense outflow, not income, opening cash or a savings transfer.'
      USING ERRCODE = '23514';
  END IF;

  IF linked_amount IS DISTINCT FROM NEW.amount_minor THEN
    RAISE EXCEPTION 'An obligation payment must pay the occurrence in full; partial or overpayment is not supported.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END
$coherence$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "money_obligations_payment_coherence" ON "public"."money_obligations";
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "money_obligations_payment_coherence"
  AFTER INSERT OR UPDATE ON "public"."money_obligations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_money_obligation_payment_coherence();
--> statement-breakpoint
-- The mirror image: a ledger row that is linked to a paid occurrence may not
-- be deleted or re-priced without the occurrence following it.
CREATE OR REPLACE FUNCTION public.enforce_linked_expense_payment_coherence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $coherence$
DECLARE
  linked_occurrence public.money_obligations;
BEGIN
  SELECT obligation.*
    INTO linked_occurrence
    FROM public.money_obligations AS obligation
   WHERE obligation.payment_expense_id = NEW.id
     AND obligation.state = 'paid';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF NEW.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'A ledger payment linked to a paid obligation cannot be deleted; undo the obligation through the MONEY-07 payment path first.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.owner_user_id IS DISTINCT FROM linked_occurrence.owner_user_id THEN
    RAISE EXCEPTION 'The linked obligation payment belongs to a different owner.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.amount_minor IS DISTINCT FROM linked_occurrence.amount_minor THEN
    RAISE EXCEPTION 'An obligation payment must pay the occurrence in full; partial or overpayment is not supported.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END
$coherence$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "personal_expenses_obligation_payment_coherence" ON "public"."personal_expenses";
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "personal_expenses_obligation_payment_coherence"
  AFTER INSERT OR UPDATE ON "public"."personal_expenses"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_linked_expense_payment_coherence();
--> statement-breakpoint
-- Atomic payment ---------------------------------------------------------------
-- One transaction owns the whole write: lock the occurrence, re-check the
-- expected version and the pending state, insert exactly one canonical ledger
-- outflow and link it. Any failure rolls back both halves.
CREATE OR REPLACE FUNCTION public.money_pay_obligation(
  p_occurrence_id uuid,
  p_expected_version integer,
  p_booking_date date,
  p_idempotency_key text,
  p_need_vs_want text,
  p_counts_in_daily boolean,
  p_payment_method text,
  p_operation_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $pay$
DECLARE
  v_owner uuid := auth.uid();
  v_occurrence public.money_obligations;
  v_payment public.personal_expenses;
  v_existing public.personal_expenses;
  v_need_vs_want text;
  v_counts_in_daily boolean;
  v_category text;
  v_purpose text;
  v_period_id uuid;
  v_fingerprint text;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to pay an obligation.'
      USING ERRCODE = '42501';
  END IF;

  IF ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
     AND NOT public.mcp_finance_grant_allows('personal_ops.write') THEN
    RAISE EXCEPTION 'The stored grant does not allow paying Money obligations.'
      USING ERRCODE = '42501';
  END IF;

  IF p_occurrence_id IS NULL OR p_expected_version IS NULL OR p_booking_date IS NULL THEN
    RAISE EXCEPTION 'An occurrence, an expected version and a booking date are required.'
      USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' OR length(p_idempotency_key) > 128 THEN
    RAISE EXCEPTION 'A payment needs an idempotency key.'
      USING ERRCODE = '22023';
  END IF;

  IF p_operation_id IS NULL OR btrim(p_operation_id) = '' OR length(p_operation_id) > 128 THEN
    RAISE EXCEPTION 'A payment needs an operation id.'
      USING ERRCODE = '22023';
  END IF;

  IF p_need_vs_want IS NOT NULL AND p_need_vs_want NOT IN ('need', 'want') THEN
    RAISE EXCEPTION 'Choose need or want for the payment.'
      USING ERRCODE = '22023';
  END IF;

  IF p_payment_method IS NOT NULL
     AND p_payment_method NOT IN ('cash', 'card', 'bank_transfer', 'mobile_wallet', 'other') THEN
    RAISE EXCEPTION 'Choose a supported payment method.'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_occurrence
    FROM public.money_obligations
   WHERE "id" = p_occurrence_id
     AND "owner_user_id" = v_owner
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The obligation was not found.'
      USING ERRCODE = 'P0002';
  END IF;

  -- A retry of the same operation returns the original result; it never pays
  -- a second time.
  IF v_occurrence."state" = 'paid'
     AND v_occurrence."payment_operation_id" = p_operation_id THEN
    SELECT *
      INTO v_payment
      FROM public.personal_expenses
     WHERE "id" = v_occurrence."payment_expense_id";

    RETURN jsonb_build_object(
      'outcome', 'replayed',
      'occurrence', to_jsonb(v_occurrence),
      'payment', jsonb_build_object(
        'expense_id', v_payment."id",
        'amount_minor', v_payment."amount_minor",
        'currency', v_payment."currency",
        'booking_date', v_payment."booking_date",
        'counts_in_daily', v_payment."counts_in_daily",
        'need_vs_want', v_payment."need_vs_want",
        'payment_method', v_payment."payment_method",
        'purpose', v_payment."purpose",
        'category', v_payment."category"
      )
    );
  END IF;

  IF v_occurrence."state" = 'paid' THEN
    RAISE EXCEPTION 'This obligation is already paid; a different operation cannot pay it again.'
      USING ERRCODE = '23514';
  END IF;

  IF v_occurrence."state" <> 'pending' THEN
    RAISE EXCEPTION 'This obligation is not pending; it cannot be paid.'
      USING ERRCODE = '23514';
  END IF;

  IF v_occurrence."version" <> p_expected_version THEN
    RAISE EXCEPTION 'The obligation changed; reload it before paying.'
      USING ERRCODE = '23514';
  END IF;

  IF v_occurrence."payment_expense_id" IS NOT NULL THEN
    RAISE EXCEPTION 'This obligation is already settled by a linked payment.'
      USING ERRCODE = '23514';
  END IF;

  -- Need/want is requested, never fabricated: the payment input wins, then the
  -- occurrence snapshot, and an unknown value is refused.
  v_need_vs_want := COALESCE(p_need_vs_want, v_occurrence."need_vs_want");

  IF v_need_vs_want IS NULL THEN
    RAISE EXCEPTION 'Choose need or want before paying this obligation.'
      USING ERRCODE = '22023';
  END IF;

  v_purpose := v_occurrence."purpose";
  v_category := v_occurrence."category";

  IF v_category IS NULL THEN
    RAISE EXCEPTION 'This obligation needs a category before it can be paid.'
      USING ERRCODE = '22023';
  END IF;

  -- A fixed payment normally excludes flexible daily spending; an explicit
  -- payment override always wins.
  v_counts_in_daily := COALESCE(
    p_counts_in_daily,
    CASE WHEN v_purpose = 'fixed' THEN false ELSE v_occurrence."counts_in_daily" END
  );

  IF p_booking_date < v_occurrence."state_effective_date" THEN
    RAISE EXCEPTION 'A payment cannot be booked before the obligation starts.'
      USING ERRCODE = '22023';
  END IF;

  SELECT expense.*
    INTO v_existing
    FROM public.personal_expenses AS expense
   WHERE expense."owner_user_id" = v_owner
     AND expense."idempotency_key" = p_idempotency_key;

  IF FOUND THEN
    IF EXISTS (
      SELECT 1
        FROM public.money_obligations AS obligation
       WHERE obligation."id" = p_occurrence_id
         AND obligation."owner_user_id" = v_owner
         AND obligation."payment_expense_id" = v_existing."id"
    ) THEN
      RETURN jsonb_build_object(
        'outcome', 'replayed',
        'occurrence', to_jsonb(v_occurrence),
        'payment', jsonb_build_object(
          'expense_id', v_existing."id",
          'amount_minor', v_existing."amount_minor",
          'currency', v_existing."currency",
          'booking_date', v_existing."booking_date",
          'counts_in_daily', v_existing."counts_in_daily",
          'need_vs_want', v_existing."need_vs_want",
          'payment_method', v_existing."payment_method",
          'purpose', v_existing."purpose",
          'category', v_existing."category"
        )
      );
    END IF;

    RAISE EXCEPTION 'That idempotency key was already used for a different payment.'
      USING ERRCODE = '23505';
  END IF;

  -- The payment belongs to the Money period that owns its booking day, so the
  -- ledger, the reserve and the period view agree.
  SELECT period."id"
    INTO v_period_id
    FROM public.money_periods AS period
   WHERE period."owner_user_id" = v_owner
     AND period."start_date" <= p_booking_date
     AND period."end_date" >= p_booking_date
   ORDER BY period."start_date" DESC
   LIMIT 1;

  v_fingerprint := encode(
    sha256(
      convert_to(
        concat_ws('|',
          v_occurrence."id"::text,
          v_occurrence."amount_minor"::text,
          v_occurrence."currency",
          p_booking_date::text,
          v_category,
          v_need_vs_want,
          v_purpose,
          v_counts_in_daily::text,
          COALESCE(p_payment_method, ''),
          p_idempotency_key,
          p_operation_id
        ),
        'utf8'
      )
    ),
    'hex'
  );

  INSERT INTO public.personal_expenses (
    "owner_user_id", "occurred_at", "amount_minor", "currency", "category",
    "note", "merchant", "need_vs_want", "payment_method", "idempotency_key",
    "create_fingerprint", "kind", "direction", "booking_date", "counts_in_daily",
    "period_id", "purpose", "created_at", "updated_at"
  ) VALUES (
    v_owner, NULL, v_occurrence."amount_minor", 'MAD', v_category,
    v_occurrence."description", NULL, v_need_vs_want, p_payment_method, p_idempotency_key,
    v_fingerprint, 'expense', 'out', p_booking_date, v_counts_in_daily,
    v_period_id, v_purpose, now(), now()
  )
  RETURNING * INTO v_payment;

  UPDATE public.money_obligations
     SET "state" = 'paid',
         "state_effective_date" = p_booking_date,
         "state_reason" = 'payment recorded',
         "payment_expense_id" = v_payment."id",
         "payment_operation_id" = p_operation_id,
         "payment_revision_operation_id" = NULL,
         "version" = "version" + 1,
         "updated_at" = now()
   WHERE "id" = p_occurrence_id
     AND "owner_user_id" = v_owner
  RETURNING * INTO v_occurrence;

  RETURN jsonb_build_object(
    'outcome', 'paid',
    'occurrence', to_jsonb(v_occurrence),
    'payment', jsonb_build_object(
      'expense_id', v_payment."id",
      'amount_minor', v_payment."amount_minor",
      'currency', v_payment."currency",
      'booking_date', v_payment."booking_date",
      'counts_in_daily', v_payment."counts_in_daily",
      'need_vs_want', v_payment."need_vs_want",
      'payment_method', v_payment."payment_method",
      'purpose', v_payment."purpose",
      'category', v_payment."category"
    )
  );
END
$pay$;
--> statement-breakpoint
-- Atomic correction -----------------------------------------------------------
-- The linked payment and the occurrence move together: the amount, the
-- booking date and the daily flag are corrected in one transaction and the
-- full-payment equality is preserved.
CREATE OR REPLACE FUNCTION public.money_correct_obligation_payment(
  p_occurrence_id uuid,
  p_expected_version integer,
  p_amount_minor integer,
  p_booking_date date,
  p_counts_in_daily boolean,
  p_operation_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $correct$
DECLARE
  v_owner uuid := auth.uid();
  v_occurrence public.money_obligations;
  v_payment public.personal_expenses;
  v_counts_in_daily boolean;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to correct an obligation payment.'
      USING ERRCODE = '42501';
  END IF;

  IF ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
     AND NOT public.mcp_finance_grant_allows('personal_ops.write') THEN
    RAISE EXCEPTION 'The stored grant does not allow correcting Money obligations.'
      USING ERRCODE = '42501';
  END IF;

  IF p_occurrence_id IS NULL OR p_expected_version IS NULL
     OR p_amount_minor IS NULL OR p_booking_date IS NULL THEN
    RAISE EXCEPTION 'An occurrence, an expected version, an amount and a booking date are required.'
      USING ERRCODE = '22023';
  END IF;

  IF p_amount_minor < 1 OR p_amount_minor > 2147483647 THEN
    RAISE EXCEPTION 'The corrected amount must be a positive number of centimes.'
      USING ERRCODE = '22023';
  END IF;

  IF p_operation_id IS NULL OR btrim(p_operation_id) = '' OR length(p_operation_id) > 128 THEN
    RAISE EXCEPTION 'A correction needs an operation id.'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_occurrence
    FROM public.money_obligations
   WHERE "id" = p_occurrence_id
     AND "owner_user_id" = v_owner
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The obligation was not found.'
      USING ERRCODE = 'P0002';
  END IF;

  -- A retry of the same correction returns the original result.
  IF v_occurrence."payment_revision_operation_id" = p_operation_id
     AND v_occurrence."state" = 'paid' THEN
    SELECT *
      INTO v_payment
      FROM public.personal_expenses
     WHERE "id" = v_occurrence."payment_expense_id";

    RETURN jsonb_build_object(
      'outcome', 'replayed',
      'occurrence', to_jsonb(v_occurrence),
      'payment', jsonb_build_object(
        'expense_id', v_payment."id",
        'amount_minor', v_payment."amount_minor",
        'currency', v_payment."currency",
        'booking_date', v_payment."booking_date",
        'counts_in_daily', v_payment."counts_in_daily",
        'need_vs_want', v_payment."need_vs_want",
        'payment_method', v_payment."payment_method",
        'purpose', v_payment."purpose",
        'category', v_payment."category"
      )
    );
  END IF;

  IF v_occurrence."state" <> 'paid' THEN
    RAISE EXCEPTION 'Only a paid obligation can be corrected.'
      USING ERRCODE = '23514';
  END IF;

  IF v_occurrence."payment_expense_id" IS NULL THEN
    RAISE EXCEPTION 'This paid obligation has no linked payment to correct.'
      USING ERRCODE = '23514';
  END IF;

  IF v_occurrence."version" <> p_expected_version THEN
    RAISE EXCEPTION 'The obligation changed; reload it before correcting the payment.'
      USING ERRCODE = '23514';
  END IF;

  SELECT *
    INTO v_payment
    FROM public.personal_expenses
   WHERE "id" = v_occurrence."payment_expense_id"
     AND "owner_user_id" = v_owner
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The linked obligation payment does not exist.'
      USING ERRCODE = '23514';
  END IF;

  IF v_payment."deleted_at" IS NOT NULL THEN
    RAISE EXCEPTION 'The linked obligation payment is deleted.'
      USING ERRCODE = '23514';
  END IF;

  v_counts_in_daily := COALESCE(p_counts_in_daily, v_occurrence."counts_in_daily");

  -- Only the MONEY-07 correction path may move a linked payment, and only
  -- inside this transaction.
  PERFORM set_config('ega.money_obligation_payment_path', 'on', true);

  UPDATE public.personal_expenses
     SET "amount_minor" = p_amount_minor,
         "booking_date" = p_booking_date,
         "counts_in_daily" = v_counts_in_daily,
         "period_id" = (
           SELECT period."id"
             FROM public.money_periods AS period
            WHERE period."owner_user_id" = v_owner
              AND p_booking_date BETWEEN period."start_date" AND period."end_date"
            ORDER BY (period."lifecycle" = 'tracking') DESC,
                     period."start_date" DESC
            LIMIT 1
         ),
         "version" = "version" + 1,
         "updated_at" = now()
   WHERE "id" = v_payment."id"
     AND "owner_user_id" = v_owner
  RETURNING * INTO v_payment;

  UPDATE public.money_obligations
     SET "amount_minor" = p_amount_minor,
         "counts_in_daily" = v_counts_in_daily,
         "payment_revision_operation_id" = p_operation_id,
         "version" = "version" + 1,
         "updated_at" = now()
   WHERE "id" = p_occurrence_id
     AND "owner_user_id" = v_owner
  RETURNING * INTO v_occurrence;

  RETURN jsonb_build_object(
    'outcome', 'corrected',
    'occurrence', to_jsonb(v_occurrence),
    'payment', jsonb_build_object(
      'expense_id', v_payment."id",
      'amount_minor', v_payment."amount_minor",
      'currency', v_payment."currency",
      'booking_date', v_payment."booking_date",
      'counts_in_daily', v_payment."counts_in_daily",
      'need_vs_want', v_payment."need_vs_want",
      'payment_method', v_payment."payment_method",
      'purpose', v_payment."purpose",
      'category', v_payment."category"
    )
  );
END
$correct$;
--> statement-breakpoint
-- Atomic undo -----------------------------------------------------------------
-- The linked payment is soft-deleted and the occurrence returns to pending in
-- one transaction, so cash and the outstanding reserve are restored together.
CREATE OR REPLACE FUNCTION public.money_undo_obligation_payment(
  p_occurrence_id uuid,
  p_expected_version integer,
  p_operation_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $undo$
DECLARE
  v_owner uuid := auth.uid();
  v_occurrence public.money_obligations;
  v_payment public.personal_expenses;
  v_effective_date date;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to undo an obligation payment.'
      USING ERRCODE = '42501';
  END IF;

  IF ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
     AND NOT public.mcp_finance_grant_allows('personal_ops.write') THEN
    RAISE EXCEPTION 'The stored grant does not allow undoing Money obligations.'
      USING ERRCODE = '42501';
  END IF;

  IF p_occurrence_id IS NULL OR p_expected_version IS NULL THEN
    RAISE EXCEPTION 'An occurrence and an expected version are required.'
      USING ERRCODE = '22023';
  END IF;

  IF p_operation_id IS NULL OR btrim(p_operation_id) = '' OR length(p_operation_id) > 128 THEN
    RAISE EXCEPTION 'An undo needs an operation id.'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_occurrence
    FROM public.money_obligations
   WHERE "id" = p_occurrence_id
     AND "owner_user_id" = v_owner
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The obligation was not found.'
      USING ERRCODE = 'P0002';
  END IF;

  -- A retry of the same undo returns the original result.
  IF v_occurrence."payment_revision_operation_id" = p_operation_id
     AND v_occurrence."state" = 'pending'
     AND v_occurrence."payment_expense_id" IS NULL THEN
    RETURN jsonb_build_object(
      'outcome', 'replayed',
      'occurrence', to_jsonb(v_occurrence),
      'payment', NULL
    );
  END IF;

  IF v_occurrence."state" <> 'paid' THEN
    RAISE EXCEPTION 'Only a paid obligation can be undone.'
      USING ERRCODE = '23514';
  END IF;

  IF v_occurrence."payment_expense_id" IS NULL THEN
    RAISE EXCEPTION 'This paid obligation has no linked payment to undo.'
      USING ERRCODE = '23514';
  END IF;

  IF v_occurrence."version" <> p_expected_version THEN
    RAISE EXCEPTION 'The obligation changed; reload it before undoing the payment.'
      USING ERRCODE = '23514';
  END IF;

  SELECT *
    INTO v_payment
    FROM public.personal_expenses
   WHERE "id" = v_occurrence."payment_expense_id"
     AND "owner_user_id" = v_owner
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The linked obligation payment does not exist.'
      USING ERRCODE = '23514';
  END IF;

  -- The obligation returns to pending as of the payment day, never before the
  -- state it is leaving.
  v_effective_date := GREATEST(v_payment."booking_date", v_occurrence."state_effective_date");

  -- Only the MONEY-07 undo path may delete a linked payment, and only inside
  -- this transaction.
  PERFORM set_config('ega.money_obligation_payment_path', 'on', true);

  UPDATE public.personal_expenses
     SET "deleted_at" = now(),
         "version" = "version" + 1,
         "updated_at" = now()
   WHERE "id" = v_payment."id"
     AND "owner_user_id" = v_owner
     AND "deleted_at" IS NULL
  RETURNING * INTO v_payment;

  UPDATE public.money_obligations
     SET "state" = 'pending',
         "state_effective_date" = v_effective_date,
         "state_reason" = 'payment undone',
         "payment_expense_id" = NULL,
         "payment_evidence" = NULL,
         "payment_operation_id" = NULL,
         "payment_revision_operation_id" = p_operation_id,
         "version" = "version" + 1,
         "updated_at" = now()
   WHERE "id" = p_occurrence_id
     AND "owner_user_id" = v_owner
  RETURNING * INTO v_occurrence;

  RETURN jsonb_build_object(
    'outcome', 'undone',
    'occurrence', to_jsonb(v_occurrence),
    'payment', jsonb_build_object(
      'expense_id', v_payment."id",
      'amount_minor', v_payment."amount_minor",
      'currency', v_payment."currency",
      'booking_date', v_payment."booking_date",
      'counts_in_daily', v_payment."counts_in_daily",
      'need_vs_want', v_payment."need_vs_want",
      'payment_method', v_payment."payment_method",
      'purpose', v_payment."purpose",
      'category', v_payment."category"
    )
  );
END
$undo$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_obligation_payment_path_active() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_obligation_payment_path_active() FROM anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.money_obligation_payment_path_active() TO authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_linked_obligation_payment_guard() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_linked_obligation_payment_guard() FROM anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_money_obligation_payment_coherence() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_money_obligation_payment_coherence() FROM anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_linked_expense_payment_coherence() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_linked_expense_payment_coherence() FROM anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_pay_obligation(
  uuid, integer, date, text, text, boolean, text, text
) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_pay_obligation(
  uuid, integer, date, text, text, boolean, text, text
) FROM anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.money_pay_obligation(
  uuid, integer, date, text, text, boolean, text, text
) TO authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_correct_obligation_payment(
  uuid, integer, integer, date, boolean, text
) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_correct_obligation_payment(
  uuid, integer, integer, date, boolean, text
) FROM anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.money_correct_obligation_payment(
  uuid, integer, integer, date, boolean, text
) TO authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_undo_obligation_payment(
  uuid, integer, text
) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_undo_obligation_payment(
  uuid, integer, text
) FROM anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.money_undo_obligation_payment(
  uuid, integer, text
) TO authenticated;

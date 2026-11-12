-- MONEY-06: bills and subscriptions as durable obligation occurrences.
--
-- Baseline: the MONEY-02..05 migrations (0094..0097) are reserved to other
-- workers in the same round; this file is only MONEY-06 and is ordered with
-- `when` 1787880000061 so it applies after them. No historical migration is
-- edited.
--
-- What this adds (additive only — no second expense ledger):
--   1. `money_obligation_templates`: recurring bill/subscription templates.
--      A template is a classification/recurrence default only. It never posts
--      a cash movement and never rewrites an occurrence that was already
--      generated from it.
--   2. `money_obligations`: one durable occurrence per obligation period,
--      owning amount, due date, period, kind, description, explicit version
--      and lifecycle (`pending|paid|waived|cancelled`). Occurrences snapshot
--      their own need/want, purpose, countsInDaily and category, so editing a
--      template cannot rewrite history.
--   3. Lifecycle and payment-link constraints:
--        * a `paid` occurrence must reference exactly one canonical
--          `personal_expenses` payment, or carry explicitly flagged
--          reconciled historical import evidence (never a bare status change);
--        * a non-paid occurrence cannot retain a payment link;
--        * `payment_expense_id` is unique, so one payment settles at most one
--          occurrence and one occurrence has at most one payment;
--        * the linked payment must belong to the same owner, be undeleted,
--          be MAD and equal the occurrence amount in full. Partial and
--          overpayment are rejected by the database, not just the UI;
--        * generic expense editing cannot mutate or soft-delete a payment that
--          is linked to a paid occurrence; MONEY-07 must unlink the occurrence
--          through the atomic correction path first.
--   4. Lifecycle guard: only explicit transitions are accepted
--      (pending->paid, pending->waived/cancelled, waived<->cancelled,
--      paid->pending), the effective date is retained and cannot move
--      backwards, version increases by exactly one, and a paid occurrence's
--      amount/due date/period/classification cannot be edited afterwards.
--   5. Owner-scoped RLS (direct user + explicit `personal_ops` grant) and
--      column-level UPDATE grants. There is no DELETE grant or policy: an
--      occurrence is cancelled/waived explicitly, never hard-deleted.
--
-- Recurrence identity: `(owner_user_id, template_id, period_start)` is unique
-- for generated occurrences, so regeneration is idempotent. Editing the
-- template later does not touch rows already generated.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."money_obligation_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid DEFAULT auth.uid() NOT NULL,
	"kind" varchar(16) NOT NULL,
	"description" varchar(200) NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'MAD' NOT NULL,
	"cadence" varchar(16) NOT NULL,
	"due_day_of_month" integer,
	"due_weekday" integer,
	"start_date" date NOT NULL,
	"end_date" date,
	"need_vs_want" varchar(8),
	"purpose" varchar(16),
	"counts_in_daily" boolean,
	"category" varchar(32),
	"lifecycle" varchar(16) DEFAULT 'active' NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"create_fingerprint" varchar(64) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "money_obligation_templates_kind_check"
		CHECK ("kind" in ('bill', 'subscription')),
	CONSTRAINT "money_obligation_templates_amount_minor_check"
		CHECK ("amount_minor" >= 1 AND "amount_minor" <= 2147483647),
	CONSTRAINT "money_obligation_templates_currency_check"
		CHECK ("currency" = 'MAD'),
	CONSTRAINT "money_obligation_templates_cadence_check"
		CHECK ("cadence" in ('weekly', 'monthly', 'quarterly', 'semiannual', 'annual')),
	CONSTRAINT "money_obligation_templates_schedule_check"
		CHECK (
			("cadence" = 'weekly' AND "due_weekday" BETWEEN 0 AND 6 AND "due_day_of_month" IS NULL)
			OR ("cadence" <> 'weekly' AND "due_day_of_month" BETWEEN 1 AND 31 AND "due_weekday" IS NULL)
		),
	CONSTRAINT "money_obligation_templates_dates_check"
		CHECK ("end_date" IS NULL OR "end_date" >= "start_date"),
	CONSTRAINT "money_obligation_templates_need_vs_want_check"
		CHECK ("need_vs_want" IS NULL OR "need_vs_want" in ('need', 'want')),
	CONSTRAINT "money_obligation_templates_purpose_check"
		CHECK ("purpose" IS NULL OR "purpose" in ('fixed', 'flexible', 'emergency')),
	CONSTRAINT "money_obligation_templates_category_check"
		CHECK ("category" IS NULL OR "category" in ('coffee', 'groceries', 'eating_out', 'transport', 'bills', 'subscriptions', 'household', 'health', 'other')),
	CONSTRAINT "money_obligation_templates_lifecycle_check"
		CHECK ("lifecycle" in ('active', 'archived')),
	CONSTRAINT "money_obligation_templates_description_check"
		CHECK (btrim("description") <> ''),
	CONSTRAINT "money_obligation_templates_idempotency_key_check"
		CHECK (btrim("idempotency_key") <> ''),
	CONSTRAINT "money_obligation_templates_create_fingerprint_check"
		CHECK ("create_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "money_obligation_templates_version_check"
		CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "money_obligation_templates_owner_idempotency_key_unique"
	ON "public"."money_obligation_templates" USING btree ("owner_user_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "money_obligation_templates_owner_kind_idx"
	ON "public"."money_obligation_templates" USING btree ("owner_user_id", "kind", "created_at" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."money_obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid DEFAULT auth.uid() NOT NULL,
	"template_id" uuid REFERENCES "public"."money_obligation_templates"("id") ON DELETE SET NULL,
	"kind" varchar(16) NOT NULL,
	"description" varchar(200) NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'MAD' NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"due_date" date NOT NULL,
	"need_vs_want" varchar(8),
	"purpose" varchar(16) NOT NULL,
	"counts_in_daily" boolean NOT NULL,
	"category" varchar(32),
	"state" varchar(16) DEFAULT 'pending' NOT NULL,
	"state_effective_date" date NOT NULL,
	"state_reason" varchar(200),
	"state_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payment_expense_id" uuid REFERENCES "public"."personal_expenses"("id") ON DELETE RESTRICT,
	"payment_evidence" jsonb,
	"idempotency_key" varchar(128) NOT NULL,
	"create_fingerprint" varchar(64) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "money_obligations_kind_check"
		CHECK ("kind" in ('bill', 'subscription')),
	CONSTRAINT "money_obligations_amount_minor_check"
		CHECK ("amount_minor" >= 1 AND "amount_minor" <= 2147483647),
	CONSTRAINT "money_obligations_currency_check"
		CHECK ("currency" = 'MAD'),
	CONSTRAINT "money_obligations_period_check"
		CHECK ("period_end" >= "period_start" AND "due_date" >= "period_start" AND "due_date" <= "period_end"),
	CONSTRAINT "money_obligations_need_vs_want_check"
		CHECK ("need_vs_want" IS NULL OR "need_vs_want" in ('need', 'want')),
	CONSTRAINT "money_obligations_purpose_check"
		CHECK ("purpose" in ('fixed', 'flexible', 'emergency')),
	CONSTRAINT "money_obligations_category_check"
		CHECK ("category" IS NULL OR "category" in ('coffee', 'groceries', 'eating_out', 'transport', 'bills', 'subscriptions', 'household', 'health', 'other', 'daily_usage', 'personal_care', 'work_tools', 'fun', 'emergency')),
	CONSTRAINT "money_obligations_state_check"
		CHECK ("state" in ('pending', 'paid', 'waived', 'cancelled')),
	CONSTRAINT "money_obligations_state_history_check"
		CHECK (jsonb_typeof("state_history") = 'array'),
	CONSTRAINT "money_obligations_description_check"
		CHECK (btrim("description") <> ''),
	CONSTRAINT "money_obligations_idempotency_key_check"
		CHECK (btrim("idempotency_key") <> ''),
	CONSTRAINT "money_obligations_create_fingerprint_check"
		CHECK ("create_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "money_obligations_version_check"
		CHECK ("version" > 0),
	CONSTRAINT "money_obligations_paid_requires_evidence_check"
		CHECK (
			"state" <> 'paid'
			OR "payment_expense_id" IS NOT NULL
			OR (
				"payment_evidence" ->> 'kind' = 'reconciled_historical_import'
				AND btrim(COALESCE("payment_evidence" ->> 'reference', '')) <> ''
			)
		),
	CONSTRAINT "money_obligations_unpaid_has_no_payment_check"
		CHECK (
			"state" = 'paid'
			OR ("payment_expense_id" IS NULL AND "payment_evidence" IS NULL)
		)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "money_obligations_owner_idempotency_key_unique"
	ON "public"."money_obligations" USING btree ("owner_user_id", "idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "money_obligations_template_period_unique"
	ON "public"."money_obligations" USING btree ("owner_user_id", "template_id", "period_start")
	WHERE "template_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "money_obligations_payment_expense_unique"
	ON "public"."money_obligations" USING btree ("payment_expense_id")
	WHERE "payment_expense_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "money_obligations_owner_kind_due_idx"
	ON "public"."money_obligations" USING btree ("owner_user_id", "kind", "due_date", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "money_obligations_owner_state_due_idx"
	ON "public"."money_obligations" USING btree ("owner_user_id", "state", "due_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "money_obligations_owner_template_idx"
	ON "public"."money_obligations" USING btree ("owner_user_id", "template_id");
--> statement-breakpoint
ALTER TABLE "public"."money_obligation_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."money_obligation_templates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."money_obligations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."money_obligations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "money_obligation_templates_direct_user_select" ON "public"."money_obligation_templates";
--> statement-breakpoint
CREATE POLICY "money_obligation_templates_direct_user_select" ON "public"."money_obligation_templates"
  FOR SELECT TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.read')
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "money_obligation_templates_direct_user_insert" ON "public"."money_obligation_templates";
--> statement-breakpoint
CREATE POLICY "money_obligation_templates_direct_user_insert" ON "public"."money_obligation_templates"
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.write')
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "money_obligation_templates_direct_user_update" ON "public"."money_obligation_templates";
--> statement-breakpoint
CREATE POLICY "money_obligation_templates_direct_user_update" ON "public"."money_obligation_templates"
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
DROP POLICY IF EXISTS "money_obligations_direct_user_select" ON "public"."money_obligations";
--> statement-breakpoint
CREATE POLICY "money_obligations_direct_user_select" ON "public"."money_obligations"
  FOR SELECT TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.read')
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "money_obligations_direct_user_insert" ON "public"."money_obligations";
--> statement-breakpoint
CREATE POLICY "money_obligations_direct_user_insert" ON "public"."money_obligations"
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.write')
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "money_obligations_direct_user_update" ON "public"."money_obligations";
--> statement-breakpoint
CREATE POLICY "money_obligations_direct_user_update" ON "public"."money_obligations"
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
CREATE OR REPLACE FUNCTION public.enforce_money_obligation_template_update()
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
    RAISE EXCEPTION 'Immutable obligation template fields cannot be changed.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
    RAISE EXCEPTION 'Obligation template version must increase by exactly one.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$guard$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "money_obligation_templates_update_guard" ON "public"."money_obligation_templates";
--> statement-breakpoint
CREATE TRIGGER "money_obligation_templates_update_guard"
  BEFORE UPDATE ON "public"."money_obligation_templates"
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_money_obligation_template_update();
--> statement-breakpoint
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
      RAISE EXCEPTION 'A paid obligation is settled by its linked payment; correct the payment through the MONEY-07 path.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END
$guard$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "money_obligations_update_guard" ON "public"."money_obligations";
--> statement-breakpoint
CREATE TRIGGER "money_obligations_update_guard"
  BEFORE UPDATE ON "public"."money_obligations"
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_money_obligation_update();
--> statement-breakpoint
-- Append-only lifecycle history. `zz_` runs after the update guard so the guard
-- validates the caller's payload before this trigger records the transition.
CREATE OR REPLACE FUNCTION public.append_money_obligation_state_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $history$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    NEW.state_history := OLD.state_history || jsonb_build_array(
      jsonb_build_object(
        'state', NEW.state,
        'effectiveDate', NEW.state_effective_date,
        'reason', NEW.state_reason,
        'version', NEW.version,
        'recordedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
    );
  END IF;
  RETURN NEW;
END
$history$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "zz_money_obligations_state_history" ON "public"."money_obligations";
--> statement-breakpoint
CREATE TRIGGER "zz_money_obligations_state_history"
  BEFORE UPDATE ON "public"."money_obligations"
  FOR EACH ROW
  EXECUTE FUNCTION public.append_money_obligation_state_history();
--> statement-breakpoint
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

  SELECT expense.owner_user_id, expense.amount_minor, expense.currency, expense.deleted_at
    INTO linked_owner, linked_amount, linked_currency, linked_deleted_at
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

  IF linked_amount IS DISTINCT FROM NEW.amount_minor THEN
    RAISE EXCEPTION 'An obligation payment must pay the occurrence in full; partial or overpayment is not supported.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$guard$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "money_obligations_payment_link_guard" ON "public"."money_obligations";
--> statement-breakpoint
CREATE TRIGGER "money_obligations_payment_link_guard"
  BEFORE INSERT OR UPDATE ON "public"."money_obligations"
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_money_obligation_payment_link();
--> statement-breakpoint
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
    OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  ) AND EXISTS (
    SELECT 1
    FROM public.money_obligations AS obligation
    WHERE obligation.payment_expense_id = OLD.id
      AND obligation.state = 'paid'
  ) THEN
    RAISE EXCEPTION 'A ledger payment linked to a paid obligation cannot be edited or deleted; correct the obligation through the MONEY-07 payment path first.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$guard$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "personal_expenses_obligation_payment_guard" ON "public"."personal_expenses";
--> statement-breakpoint
CREATE TRIGGER "personal_expenses_obligation_payment_guard"
  BEFORE UPDATE ON "public"."personal_expenses"
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_linked_obligation_payment_guard();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_money_obligation_payment_link() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_money_obligation_payment_link() FROM anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_linked_obligation_payment_guard() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_linked_obligation_payment_guard() FROM anon;
--> statement-breakpoint
REVOKE ALL ON TABLE "public"."money_obligation_templates" FROM anon;
--> statement-breakpoint
REVOKE ALL ON TABLE "public"."money_obligation_templates" FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE "public"."money_obligations" FROM anon;
--> statement-breakpoint
REVOKE ALL ON TABLE "public"."money_obligations" FROM authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE "public"."money_obligation_templates" TO authenticated;
--> statement-breakpoint
GRANT INSERT ON TABLE "public"."money_obligation_templates" TO authenticated;
--> statement-breakpoint
GRANT UPDATE (
	"description",
	"amount_minor",
	"cadence",
	"due_day_of_month",
	"due_weekday",
	"start_date",
	"end_date",
	"need_vs_want",
	"purpose",
	"counts_in_daily",
	"category",
	"lifecycle",
	"version",
	"updated_at"
) ON TABLE "public"."money_obligation_templates" TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE "public"."money_obligations" TO authenticated;
--> statement-breakpoint
GRANT INSERT ON TABLE "public"."money_obligations" TO authenticated;
--> statement-breakpoint
GRANT UPDATE (
	"description",
	"amount_minor",
	"period_start",
	"period_end",
	"due_date",
	"need_vs_want",
	"purpose",
	"counts_in_daily",
	"category",
	"state",
	"state_effective_date",
	"state_reason",
	"payment_expense_id",
	"payment_evidence",
	"version",
	"updated_at"
) ON TABLE "public"."money_obligations" TO authenticated;

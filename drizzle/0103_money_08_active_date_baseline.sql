-- Keep period updates invoker-scoped and create the day-start snapshot atomically.
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
  v_previous_active_date date;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_period
  FROM public.money_periods
  WHERE "id" = p_period_id AND "owner_user_id" = v_owner
  FOR UPDATE;

  v_previous_active_date := v_period."active_date";

  IF p_expected_version IS NULL THEN
    RAISE EXCEPTION 'An expected period version is required.'
      USING ERRCODE = '23514';
  END IF;

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

  IF v_period."active_date" > v_previous_active_date THEN
    PERFORM public.money_ensure_day_start_baseline(p_period_id, v_period."active_date");
  END IF;

  RETURN NEXT v_period;
  RETURN;
END
$update_period$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_update_period(
  uuid, integer, date, jsonb, integer, text, text, jsonb, text, timestamp with time zone
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.money_update_period(
  uuid, integer, date, jsonb, integer, text, text, jsonb, text, timestamp with time zone
) TO authenticated;

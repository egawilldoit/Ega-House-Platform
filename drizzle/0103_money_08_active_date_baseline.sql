-- Advancing the tracking date is the authorized write lifecycle for the
-- next day-start snapshot. Keep the period update and snapshot atomic.
ALTER FUNCTION public.money_update_period(
  uuid, integer, date, jsonb, integer, text, text, jsonb, text, timestamp with time zone
) RENAME TO money_update_period_v1;
-- The renamed implementation is an invoker-rights internal routine. Remove
-- inherited RPC access, then allow only the wrapper owner to call it; its table
-- access and auth.uid() checks still run with the authenticated caller's rights.
REVOKE ALL ON FUNCTION public.money_update_period_v1(
  uuid, integer, date, jsonb, integer, text, text, jsonb, text, timestamp with time zone
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.money_update_period_v1(
  uuid, integer, date, jsonb, integer, text, text, jsonb, text, timestamp with time zone
) TO CURRENT_USER;
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
) RETURNS SETOF public.money_periods
LANGUAGE plpgsql SET search_path = ''
AS $advance$
DECLARE
  v_previous date;
  v_period public.money_periods;
BEGIN
  SELECT active_date INTO v_previous FROM public.money_periods
    WHERE id = p_period_id AND owner_user_id = auth.uid();
  RETURN QUERY SELECT * FROM public.money_update_period_v1(
    p_period_id, p_expected_version, p_active_date, p_settings,
    p_opening_amount_minor, p_opening_create_fingerprint, p_opening_note,
    p_provenance, p_initialization, p_updated_at
  );
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO v_period FROM public.money_periods
    WHERE id = p_period_id AND owner_user_id = auth.uid();
  IF v_previous IS NOT NULL AND v_period.active_date > v_previous THEN
    PERFORM public.money_ensure_day_start_baseline(p_period_id, v_period.active_date);
  END IF;
  RETURN;
END
$advance$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_update_period(
  uuid, integer, date, jsonb, integer, text, text, jsonb, text, timestamp with time zone
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.money_update_period(
  uuid, integer, date, jsonb, integer, text, text, jsonb, text, timestamp with time zone
) TO authenticated;

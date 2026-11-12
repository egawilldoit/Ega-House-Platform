-- Baseline creation and rebasing both mutate durable finance state. Require the
-- explicit finance write grant for MCP callers; verified first-party sessions
-- remain authorized through the existing client_id convention.
CREATE OR REPLACE FUNCTION public.money_ensure_day_start_baseline(p_period_id uuid, p_date date)
RETURNS public.money_day_start_baselines
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $ensure$
BEGIN
  IF auth.uid() IS NULL OR (
    (SELECT auth.jwt()) ->> 'client_id' IS NOT NULL
    AND NOT public.mcp_finance_grant_allows('personal_ops.write')
  ) THEN
    RAISE EXCEPTION 'Finance write grant required' USING ERRCODE = '42501';
  END IF;
  RETURN public.money_calculate_day_start_baseline(p_period_id, p_date, false);
END
$ensure$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.money_rebase_day_start_baseline(p_period_id uuid)
RETURNS public.money_day_start_baselines
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $rebase$
DECLARE
  v_period public.money_periods;
BEGIN
  IF auth.uid() IS NULL OR (
    (SELECT auth.jwt()) ->> 'client_id' IS NOT NULL
    AND NOT public.mcp_finance_grant_allows('personal_ops.write')
  ) THEN
    RAISE EXCEPTION 'Finance write grant required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_period FROM public.money_periods
   WHERE id = p_period_id AND owner_user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR v_period.active_date <> CURRENT_DATE THEN
    RAISE EXCEPTION 'Only the owner current active date can be rebased';
  END IF;
  RETURN public.money_calculate_day_start_baseline(p_period_id, v_period.active_date, true);
END
$rebase$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_ensure_day_start_baseline(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.money_ensure_day_start_baseline(uuid, date) TO authenticated;
REVOKE ALL ON FUNCTION public.money_rebase_day_start_baseline(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.money_rebase_day_start_baseline(uuid) TO authenticated;

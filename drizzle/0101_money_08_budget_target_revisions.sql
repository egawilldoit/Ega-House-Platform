-- Record savings/emergency target changes in the day-start policy history.
-- Existing plans are intentionally not backfilled: their prior values and
-- effective dates cannot be reconstructed reliably.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.record_money_budget_target_revision()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $revision$
DECLARE
  v_period public.money_periods;
  v_policy public.money_policy_versions;
  v_version integer;
  v_settings jsonb;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.savings_target_minor IS NOT DISTINCT FROM OLD.savings_target_minor
     AND NEW.emergency_target_minor IS NOT DISTINCT FROM OLD.emergency_target_minor THEN
    RETURN NEW;
  END IF;

  -- The plan row update serializes same-plan writers; lock the canonical period
  -- as well so policy version allocation is safe with other policy writers.
  SELECT * INTO v_period FROM public.money_periods
   WHERE id = NEW.period_id AND owner_user_id = NEW.owner_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Money period is unavailable'; END IF;
  SELECT * INTO v_policy FROM public.money_policy_versions
   WHERE owner_user_id = NEW.owner_user_id AND period_id = NEW.period_id
   ORDER BY effective_date DESC, version DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Money period has no policy baseline';
  END IF;
  IF (v_policy.policy #>> '{settings,savingsTargetMinor}') IS NOT DISTINCT FROM NEW.savings_target_minor::text
     AND (v_policy.policy #>> '{settings,emergencyTargetMinor}') IS NOT DISTINCT FROM NEW.emergency_target_minor::text THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(max(version), 0) + 1 INTO v_version
    FROM public.money_policy_versions
   WHERE owner_user_id = NEW.owner_user_id AND period_id = NEW.period_id;
  v_settings := COALESCE(v_policy.policy->'settings', '{}'::jsonb)
    || jsonb_build_object('savingsTargetMinor', NEW.savings_target_minor,
                          'emergencyTargetMinor', NEW.emergency_target_minor);
  INSERT INTO public.money_policy_versions
    (owner_user_id, period_id, version, effective_date, policy)
  VALUES (NEW.owner_user_id, NEW.period_id, v_version, v_period.active_date,
    jsonb_set(v_policy.policy, '{settings}', v_settings, true));
  RETURN NEW;
END
$revision$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_money_budget_target_revision() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
DROP TRIGGER IF EXISTS money_budget_target_revision ON public.money_budget_plans;
--> statement-breakpoint
CREATE TRIGGER money_budget_target_revision
  AFTER UPDATE OF savings_target_minor, emergency_target_minor ON public.money_budget_plans
  FOR EACH ROW EXECUTE FUNCTION public.record_money_budget_target_revision();

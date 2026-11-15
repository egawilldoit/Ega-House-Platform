CREATE OR REPLACE FUNCTION public.money_rollover_period(
  p_source_period_id uuid,
  p_expected_version integer,
  p_start_date date,
  p_end_date date,
  p_active_date date,
  p_timezone text,
  p_initialized text,
  p_allow_uncovered_days boolean,
  p_opening_amount_minor integer,
  p_opening_cutoff_date date,
  p_opening_evidence text,
  p_opening_note text,
  p_opening_create_fingerprint text,
  p_provenance jsonb,
  p_settings jsonb,
  p_operation_id text,
  p_request_fingerprint text,
  p_opening_mode text,
  p_unpaid_treatment text,
  p_unpaid_reason text,
  p_reconciliation_accepted_note text,
  p_reconciliation jsonb,
  p_occurrences jsonb,
  p_carried_occurrences jsonb,
  p_created_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $rollover$
DECLARE
  v_owner uuid := auth.uid();
  v_source public.money_periods;
  v_existing public.money_period_rollovers;
  v_successor_id uuid := gen_random_uuid();
  v_opening_id uuid;
  v_policy_id uuid;
  v_record public.money_period_rollovers;
  v_pending_count integer := 0;
  v_generated integer := 0;
  v_carried integer := 0;
  v_cancelled integer := 0;
  v_item jsonb;
  v_source_occurrence public.money_obligations;
  v_receipt_id uuid;
  v_source_opening integer;
  v_modeled_closing integer;
  v_close_summary jsonb;
  v_restated_closes integer;
  v_paid_mismatches integer;
  v_visit_mismatches integer;
  v_source_policy public.money_policy_versions;
  v_successor_settings jsonb;
  v_required_closes integer;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501';
  END IF;
  IF (SELECT auth.jwt()) ->> 'client_id' IS NOT NULL
     AND NOT public.mcp_finance_grant_allows('personal_ops.write') THEN
    RAISE EXCEPTION 'Finance write grant required' USING ERRCODE = '42501';
  END IF;
  IF p_operation_id IS NULL OR btrim(p_operation_id) = '' THEN
    RAISE EXCEPTION 'A stable operation id is required.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_source
  FROM public.money_periods
  WHERE id = p_source_period_id AND owner_user_id = v_owner
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The source Money period was not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_existing
  FROM public.money_period_rollovers
  WHERE owner_user_id = v_owner AND operation_id = btrim(p_operation_id);
  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM p_request_fingerprint THEN
      RAISE EXCEPTION 'This operation id was used for a different rollover request.'
        USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('rollover', to_jsonb(v_existing), 'replayed', true);
  END IF;

  IF v_source.version <> p_expected_version THEN
    RAISE EXCEPTION 'The source period changed since it was read.' USING ERRCODE = '40001';
  END IF;
  IF v_source.lifecycle <> 'ended' THEN
    RAISE EXCEPTION 'Only an ended period can be rolled over. Close the final day first.'
      USING ERRCODE = '23514';
  END IF;
  IF v_source.active_date <> v_source.end_date THEN
    RAISE EXCEPTION 'The source period still has unclosed tracked days.'
      USING ERRCODE = '23514';
  END IF;
  IF v_source.successor_period_id IS NOT NULL THEN
    RAISE EXCEPTION 'This period already has a successor.' USING ERRCODE = '23505';
  END IF;
  IF p_start_date < v_source.end_date + 1 OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'The successor dates must start after the source period ends.'
      USING ERRCODE = '23514';
  END IF;
  IF p_start_date > v_source.end_date + 1 AND NOT COALESCE(p_allow_uncovered_days, false) THEN
    RAISE EXCEPTION 'Days between the source end and the successor start would belong to no period. Allow them explicitly.'
      USING ERRCODE = '23514';
  END IF;
  IF p_end_date - p_start_date + 1 > 366 THEN
    RAISE EXCEPTION 'A Money period can cover at most 366 days.' USING ERRCODE = '23514';
  END IF;
  IF p_active_date <> p_start_date THEN
    RAISE EXCEPTION 'The successor active date must be its start date.'
      USING ERRCODE = '23514';
  END IF;
  IF NULLIF(btrim(COALESCE(p_timezone, '')), '') IS NULL THEN
    RAISE EXCEPTION 'The successor timezone is required.' USING ERRCODE = '23514';
  END IF;
  IF p_initialized NOT IN ('initialized', 'reconciled') THEN
    RAISE EXCEPTION 'The successor opening initialization is invalid.' USING ERRCODE = '23514';
  END IF;
  IF p_opening_mode NOT IN ('carry_forward', 'verified_source') THEN
    RAISE EXCEPTION 'The successor opening mode is invalid.' USING ERRCODE = '23514';
  END IF;
  IF p_opening_mode = 'carry_forward' AND p_initialized <> 'initialized' THEN
    RAISE EXCEPTION 'A carried opening is initialized, not independently reconciled.'
      USING ERRCODE = '23514';
  END IF;
  IF p_opening_mode = 'verified_source' AND p_initialized <> 'reconciled' THEN
    RAISE EXCEPTION 'A verified opening must retain reconciled evidence.'
      USING ERRCODE = '23514';
  END IF;
  IF p_opening_amount_minor IS NULL OR p_opening_amount_minor < 0 THEN
    RAISE EXCEPTION 'A known non-negative successor opening is required.'
      USING ERRCODE = '23514';
  END IF;
  IF p_opening_cutoff_date IS NULL OR p_opening_cutoff_date > p_start_date THEN
    RAISE EXCEPTION 'The opening cutoff must be recorded on or before the successor start.'
      USING ERRCODE = '23514';
  END IF;
  IF p_opening_mode = 'verified_source'
     AND NULLIF(btrim(COALESCE(p_opening_evidence, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A verified opening must retain its evidence.'
      USING ERRCODE = '23514';
  END IF;
  IF p_settings IS NOT NULL AND jsonb_typeof(p_settings) <> 'object' THEN
    RAISE EXCEPTION 'Successor settings overrides must be a JSON object.'
      USING ERRCODE = '23514';
  END IF;
  IF p_settings ? 'savingsTargetMinor' AND jsonb_typeof(p_settings -> 'savingsTargetMinor') <> 'null' AND (
    jsonb_typeof(p_settings -> 'savingsTargetMinor') <> 'number'
    OR (p_settings ->> 'savingsTargetMinor')::numeric < 0
    OR (p_settings ->> 'savingsTargetMinor')::numeric > 2147483647
    OR (p_settings ->> 'savingsTargetMinor')::numeric <> trunc((p_settings ->> 'savingsTargetMinor')::numeric)
  ) THEN
    RAISE EXCEPTION 'savingsTargetMinor must be a non-negative integer.'
      USING ERRCODE = '23514';
  END IF;
  IF p_settings ? 'emergencyTargetMinor' AND jsonb_typeof(p_settings -> 'emergencyTargetMinor') <> 'null' AND (
    jsonb_typeof(p_settings -> 'emergencyTargetMinor') <> 'number'
    OR (p_settings ->> 'emergencyTargetMinor')::numeric < 0
    OR (p_settings ->> 'emergencyTargetMinor')::numeric > 2147483647
    OR (p_settings ->> 'emergencyTargetMinor')::numeric <> trunc((p_settings ->> 'emergencyTargetMinor')::numeric)
  ) THEN
    RAISE EXCEPTION 'emergencyTargetMinor must be a non-negative integer.'
      USING ERRCODE = '23514';
  END IF;
  IF p_unpaid_treatment IS NOT NULL
     AND p_unpaid_treatment NOT IN ('keep_pending', 'carry_forward', 'cancel') THEN
    RAISE EXCEPTION 'The unpaid-item treatment is invalid.' USING ERRCODE = '23514';
  END IF;
  IF p_unpaid_treatment IN ('carry_forward', 'cancel')
     AND NULLIF(btrim(COALESCE(p_unpaid_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Cancelling or carrying forward unpaid occurrences needs a reason.'
      USING ERRCODE = '23514';
  END IF;

  -- The source must carry real MONEY-09 close evidence through its final day,
  -- and any restated close snapshot must be accepted with retained provenance.
  -- This repeats the preview comparison inside the atomic write so a stale
  -- preview cannot roll over an unexamined restatement.
  v_close_summary := public.money_rollover_close_snapshot_summary(v_source.id);
  IF COALESCE((v_close_summary ->> 'available')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'The source period has no comparable day-close evidence.'
      USING ERRCODE = '23514';
  END IF;
  v_required_closes := COALESCE((v_close_summary ->> 'requiredCloseCount')::integer, 0);
  IF COALESCE((v_close_summary ->> 'completeCloseEvidence')::boolean, false) IS NOT TRUE
     OR COALESCE((v_close_summary ->> 'closeCount')::integer, 0) <> v_required_closes THEN
    RAISE EXCEPTION 'Every tracked source day needs retained close evidence before rollover.'
      USING ERRCODE = '23514',
            DETAIL = 'Missing close dates: ' || COALESCE(
              (SELECT string_agg(entry, ', ')
               FROM jsonb_array_elements_text(
                 COALESCE(v_close_summary -> 'missingCloseDates', '[]'::jsonb)
               ) AS entry),
              'unknown'
            );
  END IF;
  IF COALESCE((v_close_summary ->> 'comparableToRestatedTotals')::boolean, false) IS NOT TRUE
     OR (v_close_summary ->> 'lastClosedDate')::date IS DISTINCT FROM v_source.end_date THEN
    RAISE EXCEPTION 'The final source day must be closed and comparable to its restated totals.'
      USING ERRCODE = '23514';
  END IF;
  v_restated_closes := COALESCE((v_close_summary ->> 'restatedDifferenceCount')::integer, 0);
  v_paid_mismatches := COALESCE((v_close_summary ->> 'paidObligationMismatchCount')::integer, 0);
  v_visit_mismatches := COALESCE((v_close_summary ->> 'countedVisitMismatchCount')::integer, 0);
  IF (v_restated_closes > 0 OR v_paid_mismatches > 0 OR v_visit_mismatches > 0
      OR (v_close_summary ->> 'savingsTargetMinor' IS NOT NULL
          AND (v_close_summary ->> 'savingsTargetMinor')::integer
              <> (v_close_summary ->> 'savingsTransferredMinor')::integer))
     AND NULLIF(btrim(COALESCE(p_reconciliation_accepted_note, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Restated closes, payment, counted-visit or savings differences need an explicit acceptance note before rollover.'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_pending_count
  FROM public.money_obligations
  WHERE owner_user_id = v_owner
    AND state = 'pending'
    AND period_start <= v_source.end_date
    AND period_end >= v_source.start_date;
  IF v_pending_count > 0 AND p_unpaid_treatment IS NULL THEN
    RAISE EXCEPTION 'Unpaid source occurrences need an explicit treatment.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.money_periods AS existing
    WHERE existing.owner_user_id = v_owner
      AND daterange(existing.start_date, existing.end_date, '[]')
          && daterange(p_start_date, p_end_date, '[]')
  ) THEN
    RAISE EXCEPTION 'A Money period already overlaps those dates.' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.money_periods AS existing
    WHERE existing.owner_user_id = v_owner AND existing.lifecycle = 'tracking'
  ) THEN
    RAISE EXCEPTION 'A tracking period already exists; rollover creates the only tracking period.'
      USING ERRCODE = '23505';
  END IF;

  -- Re-derive modeled closing cash in this transaction. Unknown stays unknown:
  -- a missing source opening cannot be carried forward as zero.
  SELECT amount_minor INTO v_source_opening
  FROM public.personal_expenses
  WHERE owner_user_id = v_owner
    AND id = v_source.opening_movement_id
    AND kind = 'opening'
    AND deleted_at IS NULL;

  IF v_source_opening IS NULL THEN
    IF p_opening_mode = 'carry_forward' THEN
      RAISE EXCEPTION 'Closing cash is unknown and cannot be carried forward as zero.'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT v_source_opening + COALESCE(sum(
        CASE WHEN movement.direction = 'in' THEN movement.amount_minor
             ELSE -movement.amount_minor END
      ), 0)::integer
      INTO v_modeled_closing
    FROM public.personal_expenses AS movement
    WHERE movement.owner_user_id = v_owner
      AND movement.booking_date >= v_source.start_date
      AND movement.booking_date <= v_source.end_date
      AND movement.deleted_at IS NULL
      AND movement.kind <> 'opening';
  END IF;

  IF p_opening_mode = 'carry_forward' THEN
    IF v_modeled_closing IS DISTINCT FROM p_opening_amount_minor THEN
      RAISE EXCEPTION 'Closing cash changed since the preview. Reload before rolling over.'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  SELECT * INTO v_source_policy
  FROM public.money_policy_versions
  WHERE owner_user_id = v_owner AND period_id = v_source.id
  ORDER BY effective_date DESC, version DESC
  LIMIT 1;
  v_successor_settings := COALESCE(v_source_policy.policy -> 'settings', v_source.settings, '{}'::jsonb)
    || COALESCE(p_settings, '{}'::jsonb);

  INSERT INTO public.money_periods (
    id, owner_user_id, start_date, end_date, currency, timezone, active_date,
    lifecycle, initialization, opening_movement_id, provenance, settings,
    version, created_at, updated_at
  ) VALUES (
    v_successor_id, v_owner, p_start_date, p_end_date, 'MAD', btrim(p_timezone),
    p_active_date, 'tracking', 'uninitialized', NULL, p_provenance, v_successor_settings,
    1, p_created_at, p_created_at
  );

  INSERT INTO public.personal_expenses (
    owner_user_id, occurred_at, amount_minor, currency, category, note, merchant,
    need_vs_want, payment_method, idempotency_key, create_fingerprint, kind,
    direction, booking_date, counts_in_daily, period_id, created_at, updated_at
  ) VALUES (
    v_owner, NULL, p_opening_amount_minor, 'MAD', NULL, p_opening_note, NULL,
    NULL, NULL, 'opening:' || v_successor_id, p_opening_create_fingerprint,
    'opening', 'in', p_start_date, false, v_successor_id, p_created_at, p_created_at
  )
  RETURNING id INTO v_opening_id;

  UPDATE public.money_periods
  SET initialization = p_initialized,
      opening_movement_id = v_opening_id,
      provenance = p_provenance,
      version = version + 1,
      updated_at = p_created_at
  WHERE id = v_successor_id AND owner_user_id = v_owner;

  INSERT INTO public.money_policy_versions (
    owner_user_id, period_id, version, effective_date, policy, created_at
  ) VALUES (
    v_owner, v_successor_id, 1, p_active_date,
    jsonb_build_object(
      'settings', v_successor_settings,
      'algorithmVersion', 'safe-flexible-start-of-day-v1',
      'rolledOverFrom', v_source.id
    ),
    p_created_at
  )
  RETURNING id INTO v_policy_id;

  INSERT INTO public.money_day_start_baselines (
    owner_user_id, period_id, date, version, policy_version_id, algorithm_version,
    availability, unavailable_reason, inputs, created_at
  ) VALUES (
    v_owner, v_successor_id, p_active_date, 1, v_policy_id,
    'safe-flexible-start-of-day-v1', 'unavailable', 'initial_setup_incomplete',
    jsonb_build_object('setupComplete', false, 'rolledOverFrom', v_source.id),
    p_created_at
  );

  -- Generated occurrences come from the canonical recurrence rules resolved in
  -- the application. The stable idempotency key and the partial
  -- (owner, template, period_start) index make this regeneration idempotent.
  FOR v_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_occurrences, '[]'::jsonb))
  LOOP
    INSERT INTO public.money_obligations (
      owner_user_id, template_id, kind, description, amount_minor, currency,
      period_start, period_end, due_date, need_vs_want, purpose, counts_in_daily,
      category, state, state_effective_date, state_history, idempotency_key,
      create_fingerprint, version, created_at, updated_at
    ) VALUES (
      v_owner,
      NULLIF(v_item->'values'->>'templateId', '')::uuid,
      v_item->'values'->>'kind',
      v_item->'values'->>'description',
      (v_item->'values'->>'amountMinor')::integer,
      'MAD',
      (v_item->'values'->>'periodStart')::date,
      (v_item->'values'->>'periodEnd')::date,
      (v_item->'values'->>'dueDate')::date,
      NULLIF(v_item->'values'->>'needVsWant', ''),
      v_item->'values'->>'purpose',
      (v_item->'values'->>'countsInDaily')::boolean,
      NULLIF(v_item->'values'->>'category', ''),
      'pending',
      (v_item->'values'->>'stateEffectiveDate')::date,
      '[]'::jsonb,
      v_item->'values'->>'idempotencyKey',
      v_item->>'createFingerprint',
      1, p_created_at, p_created_at
    )
    ON CONFLICT (owner_user_id, idempotency_key) DO NOTHING;
    IF FOUND THEN
      v_generated := v_generated + 1;
    END IF;
  END LOOP;

  -- Explicit unpaid-item treatment. A template-backed occurrence is already
  -- regenerated by its template for the new period, so carry_forward applies to
  -- one-off occurrences; cancel is available for any pending occurrence.
  IF p_unpaid_treatment = 'cancel' THEN
    FOR v_source_occurrence IN
      SELECT * FROM public.money_obligations
      WHERE owner_user_id = v_owner
        AND state = 'pending'
        AND period_start <= v_source.end_date
        AND period_end >= v_source.start_date
      FOR UPDATE
    LOOP
      UPDATE public.money_obligations
      SET state = 'cancelled',
          state_effective_date = v_source.end_date,
          state_reason = left(btrim(p_unpaid_reason), 200),
          version = version + 1,
          updated_at = p_created_at
      WHERE id = v_source_occurrence.id
        AND owner_user_id = v_owner
        AND version = v_source_occurrence.version;
      IF FOUND THEN
        v_cancelled := v_cancelled + 1;
      ELSE
        RAISE EXCEPTION 'An unpaid occurrence changed during rollover.' USING ERRCODE = '40001';
      END IF;
    END LOOP;
  ELSIF p_unpaid_treatment = 'carry_forward' THEN
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(COALESCE(p_carried_occurrences, '[]'::jsonb))
    LOOP
      SELECT * INTO v_source_occurrence
      FROM public.money_obligations
      WHERE id = (v_item->>'occurrenceId')::uuid
        AND owner_user_id = v_owner
        AND state = 'pending'
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'A carried pending occurrence changed during rollover.'
          USING ERRCODE = '40001';
      END IF;
      IF v_source_occurrence.template_id IS NOT NULL THEN
        RAISE EXCEPTION 'A template-backed occurrence is regenerated by its template and cannot be carried forward as a second row.'
          USING ERRCODE = '23514';
      END IF;

      INSERT INTO public.money_obligations (
        owner_user_id, template_id, kind, description, amount_minor, currency,
        period_start, period_end, due_date, need_vs_want, purpose, counts_in_daily,
        category, state, state_effective_date, state_history, idempotency_key,
        create_fingerprint, version, created_at, updated_at
      ) VALUES (
        v_owner, NULL, v_source_occurrence.kind, v_source_occurrence.description,
        v_source_occurrence.amount_minor, 'MAD',
        (v_item->>'periodStart')::date, (v_item->>'periodEnd')::date,
        (v_item->>'dueDate')::date, v_source_occurrence.need_vs_want,
        COALESCE(v_source_occurrence.purpose, 'fixed'),
        COALESCE(v_source_occurrence.counts_in_daily, false),
        COALESCE(
          v_source_occurrence.category,
          CASE WHEN v_source_occurrence.kind = 'subscription'
            THEN 'subscriptions' ELSE 'bills' END
        ), 'pending',
        (v_item->>'periodStart')::date, '[]'::jsonb,
        v_item->>'idempotencyKey', v_item->>'createFingerprint',
        1, p_created_at, p_created_at
      )
      ON CONFLICT (owner_user_id, idempotency_key) DO NOTHING;
      IF FOUND THEN
        v_carried := v_carried + 1;
      END IF;

      UPDATE public.money_obligations
      SET state = 'cancelled',
          state_effective_date = v_source.end_date,
          state_reason = left(btrim(p_unpaid_reason), 200),
          version = version + 1,
          updated_at = p_created_at
      WHERE id = v_source_occurrence.id
        AND owner_user_id = v_owner
        AND version = v_source_occurrence.version;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'A carried pending occurrence changed during rollover.'
          USING ERRCODE = '40001';
      END IF;
      v_cancelled := v_cancelled + 1;
    END LOOP;
  END IF;

  UPDATE public.money_periods
  SET lifecycle = 'rolled_over',
      successor_period_id = v_successor_id,
      rolled_over_at = p_created_at,
      version = version + 1,
      updated_at = p_created_at
  WHERE id = v_source.id AND owner_user_id = v_owner
  RETURNING * INTO v_source;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The source period could not be marked rolled over.' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.money_period_rollovers (
    owner_user_id, source_period_id, successor_period_id, operation_id,
    request_fingerprint, opening_mode, opening_amount_minor, closing_cash_minor,
    closing_cutoff_date, unpaid_treatment, reconciliation_accepted_note,
    reconciliation, generated_occurrence_count, carried_occurrence_count,
    cancelled_occurrence_count, created_at
  ) VALUES (
    v_owner, v_source.id, v_successor_id, btrim(p_operation_id),
    p_request_fingerprint, p_opening_mode, p_opening_amount_minor,
    v_modeled_closing, v_source.end_date, p_unpaid_treatment,
    p_reconciliation_accepted_note, COALESCE(p_reconciliation, '{}'::jsonb) || jsonb_build_object('closeSummary', v_close_summary),
    v_generated, v_carried, v_cancelled, p_created_at
  )
  RETURNING * INTO v_record;

  RETURN jsonb_build_object('rollover', to_jsonb(v_record), 'replayed', false);
END
$rollover$;

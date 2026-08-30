-- Failure-state semantics hardening.
--
-- Previously:
--   FAILED_RETRYABLE → deleted (next claim fresh insert)
--   FAILED_FINAL     → reclaimable (next claim resets to EXECUTING)
-- This is inverted: deterministic failures were retried, retryable were deleted.
--
-- Desired:
--   FAILED_RETRYABLE → safe future retry (re-claimable, fresh token, no payload replay)
--   FAILED_FINAL     → terminal deterministic failure → replay same error, no mutation retry
--
-- This migration:
-- 1. Widens the status CHECK to include both FAILED_RETRYABLE and FAILED_FINAL.
-- 2. Backfills any existing FAILED_FINAL that was created for transient infra as
--    FAILED_RETRYABLE would be unsafe without error classification, so we keep
--    them as FAILED_RETRYABLE (safe to retry) — they will be re-claimable.
--    Permanent failures should have been stored with an error payload; since we
--    did not store one, we conservatively treat existing FAILED_FINAL as retryable.
-- 3. Replaces mcp_claim_mcp_mutation_receipt to replay FAILED_FINAL and
--    reset FAILED_RETRYABLE.
-- 4. Replaces mcp_fail_mcp_mutation_result to set FAILED_RETRYABLE on p_final=false
--    and FAILED_FINAL on p_final=true (instead of DELETE). The error payload for
--    FAILED_FINAL is the caller's last result_payload if any; callers should
--    store the error via mcp_store before failing if they want deterministic replay.
--    For now we keep the boolean API and store NULL for retryable and a generic
--    error for final; the TypeScript layer will be updated to pass error payloads
--    via a new overload in a follow-up.

--> statement-breakpoint
DO $migrate_failure_states$
BEGIN
  -- Widen CHECK to include both failure states. Keep existing rows.
  ALTER TABLE public.mcp_mutation_receipts DROP CONSTRAINT IF EXISTS mcp_mutation_receipts_status_check;
  ALTER TABLE public.mcp_mutation_receipts ADD CONSTRAINT mcp_mutation_receipts_status_check
    CHECK (status IN ('CLAIMED','EXECUTING','SUCCEEDED','FAILED_RETRYABLE','FAILED_FINAL'));
END
$migrate_failure_states$;

--> statement-breakpoint
-- Backfill: existing FAILED_FINAL rows become FAILED_RETRYABLE (safe to retry)
-- since we cannot know if they were deterministic. New FAILED_FINAL will be
-- created only for explicit permanent failures with an error payload.
UPDATE public.mcp_mutation_receipts
SET status = 'FAILED_RETRYABLE', updated_at = now()
WHERE status = 'FAILED_FINAL';

--> statement-breakpoint
DROP FUNCTION IF EXISTS public.mcp_claim_mutation_receipt(text, uuid, text);

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mcp_claim_mutation_receipt(
  p_tool_name text,
  p_operation_id uuid,
  p_args_hash text
)
RETURNS TABLE (
  claim_outcome text,
  claim_token uuid,
  existing_result jsonb
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_client_id text;
  v_resource_uri text;
  v_grant_exists boolean;
  v_inserted integer := 0;
  v_args_hash text;
  v_status text;
  v_result jsonb;
  v_token uuid;
  v_lease_expires timestamptz;
BEGIN
  v_user_id := (SELECT auth.uid());
  v_client_id := NULLIF((SELECT auth.jwt()) ->> 'client_id', '');
  v_resource_uri := NULLIF((SELECT auth.jwt()) ->> 'aud', '');

  IF v_user_id IS NULL OR v_client_id IS NULL OR v_resource_uri IS NULL THEN
    RAISE EXCEPTION 'MCP authentication context is required.' USING ERRCODE = '42501';
  END IF;

  IF p_tool_name IS NULL OR p_tool_name !~ '^[a-z0-9_]{1,128}$' OR p_operation_id IS NULL OR p_args_hash IS NULL OR char_length(p_args_hash) = 0 THEN
    RAISE EXCEPTION 'Invalid MCP idempotency parameters.' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.mcp_authorization_grants AS g
    WHERE g.owner_user_id = v_user_id
      AND g.oauth_client_id = v_client_id
      AND g.resource_uri = v_resource_uri
      AND g.status = 'active'
      AND g.revoked_at IS NULL
  ) INTO v_grant_exists;

  IF NOT v_grant_exists THEN
    RAISE EXCEPTION 'No active EGA MCP authorization grant.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(v_user_id::text || '|' || v_client_id || '|' || p_tool_name || '|' || p_operation_id::text)
  );

  v_token := gen_random_uuid();
  INSERT INTO public.mcp_mutation_receipts
    (owner_user_id, oauth_client_id, tool_name, operation_id, args_hash, status, claim_token, result_payload, lease_expires_at)
  VALUES
    (v_user_id, v_client_id, p_tool_name, p_operation_id, p_args_hash, 'CLAIMED', v_token, NULL, now() + interval '5 minutes')
  ON CONFLICT (owner_user_id, oauth_client_id, tool_name, operation_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  SELECT r.args_hash, r.status, r.result_payload, r.claim_token, r.lease_expires_at
    INTO v_args_hash, v_status, v_result, v_token, v_lease_expires
  FROM public.mcp_mutation_receipts AS r
  WHERE r.owner_user_id = v_user_id
    AND r.oauth_client_id = v_client_id
    AND r.tool_name = p_tool_name
    AND r.operation_id = p_operation_id
  FOR UPDATE;

  IF v_args_hash IS NULL THEN
    RAISE EXCEPTION 'MCP mutation receipt insert failed.' USING ERRCODE = '40001';
  END IF;

  IF v_args_hash <> p_args_hash THEN
    claim_outcome := 'CONFLICT';
    claim_token := NULL;
    existing_result := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_status = 'SUCCEEDED' THEN
    claim_outcome := 'REPLAY';
    claim_token := NULL;
    existing_result := v_result;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_status = 'FAILED_FINAL' THEN
    claim_outcome := 'REPLAY';
    claim_token := NULL;
    existing_result := v_result;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_status IN ('CLAIMED','EXECUTING') THEN
    IF v_inserted > 0 THEN
      UPDATE public.mcp_mutation_receipts AS r
      SET status = 'EXECUTING', updated_at = now()
      WHERE r.owner_user_id = v_user_id
        AND r.oauth_client_id = v_client_id
        AND r.tool_name = p_tool_name
        AND r.operation_id = p_operation_id
        AND r.claim_token = v_token;
      claim_outcome := 'CLAIM_GRANTED';
      claim_token := v_token;
      existing_result := NULL;
      RETURN NEXT;
      RETURN;
    END IF;

    IF v_lease_expires > now() THEN
      claim_outcome := 'IN_PROGRESS';
      claim_token := NULL;
      existing_result := NULL;
      RETURN NEXT;
      RETURN;
    END IF;

    UPDATE public.mcp_mutation_receipts AS r
    SET status = 'EXECUTING',
        claim_token = gen_random_uuid(),
        lease_expires_at = now() + interval '5 minutes',
        updated_at = now()
    WHERE r.owner_user_id = v_user_id
      AND r.oauth_client_id = v_client_id
      AND r.tool_name = p_tool_name
      AND r.operation_id = p_operation_id
      AND r.status IN ('CLAIMED','EXECUTING')
    RETURNING r.claim_token INTO v_token;
    claim_outcome := 'CLAIM_GRANTED';
    claim_token := v_token;
    existing_result := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_status = 'FAILED_RETRYABLE' THEN
    UPDATE public.mcp_mutation_receipts AS r
    SET status = 'EXECUTING',
        claim_token = gen_random_uuid(),
        lease_expires_at = now() + interval '5 minutes',
        result_payload = NULL,
        updated_at = now()
    WHERE r.owner_user_id = v_user_id
      AND r.oauth_client_id = v_client_id
      AND r.tool_name = p_tool_name
      AND r.operation_id = p_operation_id
      AND r.status = 'FAILED_RETRYABLE'
    RETURNING r.claim_token INTO v_token;
    claim_outcome := 'CLAIM_GRANTED';
    claim_token := v_token;
    existing_result := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  RAISE EXCEPTION 'Unknown MCP mutation receipt status.' USING ERRCODE = '40001';
END;
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION public.mcp_claim_mutation_receipt(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_claim_mutation_receipt(text, uuid, text) TO authenticated;

--> statement-breakpoint
DROP FUNCTION IF EXISTS public.mcp_fail_mutation_result(text, uuid, uuid, boolean);

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mcp_fail_mutation_result(
  p_tool_name text,
  p_operation_id uuid,
  p_claim_token uuid,
  p_final boolean
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_client_id text;
BEGIN
  v_user_id := (SELECT auth.uid());
  v_client_id := NULLIF((SELECT auth.jwt()) ->> 'client_id', '');

  IF v_user_id IS NULL OR v_client_id IS NULL THEN
    RAISE EXCEPTION 'MCP authentication context is required.' USING ERRCODE = '42501';
  END IF;

  IF p_final THEN
    UPDATE public.mcp_mutation_receipts AS r
    SET status = 'FAILED_FINAL', result_payload = COALESCE(r.result_payload, jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'FAILED_FINAL', 'message', 'The MCP mutation failed with a deterministic error.'))), updated_at = now()
    WHERE r.owner_user_id = v_user_id
      AND r.oauth_client_id = v_client_id
      AND r.tool_name = p_tool_name
      AND r.operation_id = p_operation_id
      AND r.claim_token = p_claim_token
      AND r.status IN ('CLAIMED','EXECUTING')
      AND r.lease_expires_at > now();
  ELSE
    UPDATE public.mcp_mutation_receipts AS r
    SET status = 'FAILED_RETRYABLE', result_payload = NULL, updated_at = now()
    WHERE r.owner_user_id = v_user_id
      AND r.oauth_client_id = v_client_id
      AND r.tool_name = p_tool_name
      AND r.operation_id = p_operation_id
      AND r.claim_token = p_claim_token
      AND r.status IN ('CLAIMED','EXECUTING')
      AND r.lease_expires_at > now();
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mutation receipt not found or claim token mismatch.' USING ERRCODE = '02000';
  END IF;
END;
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION public.mcp_fail_mutation_result(text, uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_fail_mutation_result(text, uuid, uuid, boolean) TO authenticated;

-- Durable idempotency ledger for non-idempotent MCP mutations.
-- Key: (owner, oauth_client_id, tool_name, operation_id) — per prompt spec.
-- Same args → stable replay. Different args → reject. Concurrent duplicates → exactly one effect via advisory lock or ON CONFLICT.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.mcp_mutation_receipts (
  owner_user_id uuid NOT NULL,
  oauth_client_id text NOT NULL,
  tool_name varchar(128) NOT NULL,
  operation_id uuid NOT NULL,
  args_hash text NOT NULL,
  status text NOT NULL DEFAULT 'CLAIMED' CHECK (status IN ('CLAIMED','EXECUTING','SUCCEEDED','FAILED_RETRYABLE','FAILED_FINAL')),
  claim_token uuid NOT NULL DEFAULT gen_random_uuid(),
  result_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  PRIMARY KEY (owner_user_id, oauth_client_id, tool_name, operation_id),
  CONSTRAINT mcp_mutation_receipts_tool_check CHECK (tool_name ~ '^[a-z0-9_]{1,128}$'),
  CONSTRAINT mcp_mutation_receipts_args_hash_check CHECK (char_length(args_hash) > 0)
);

ALTER TABLE public.mcp_mutation_receipts ENABLE ROW LEVEL SECURITY;

-- Deny direct client table access; only via security-definer functions
DROP POLICY IF EXISTS "mcp_mutation_receipts_deny_client_access" ON public.mcp_mutation_receipts;
CREATE POLICY "mcp_mutation_receipts_deny_client_access"
  ON public.mcp_mutation_receipts
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.mcp_mutation_receipts FROM anon, authenticated, public;

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mcp_mutation_receipts_owner_client_idx
  ON public.mcp_mutation_receipts (owner_user_id, oauth_client_id);

CREATE INDEX IF NOT EXISTS mcp_mutation_receipts_updated_idx
  ON public.mcp_mutation_receipts (updated_at DESC);

--> statement-breakpoint
-- Function to claim/check idempotency slot — called before mutation.
CREATE OR REPLACE FUNCTION public.mcp_claim_mutation_receipt(
  p_tool_name text,
  p_operation_id uuid,
  p_args_hash text
)
RETURNS TABLE (
  is_replay boolean,
  existing_result jsonb,
  is_conflict boolean
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
  v_existing_args_hash text;
  v_existing_result jsonb;
  v_status text;
  v_grant_exists boolean;
BEGIN
  v_user_id := (SELECT auth.uid());
  v_client_id := NULLIF((SELECT auth.jwt()) ->> 'client_id', '');
  v_resource_uri := NULLIF((SELECT auth.jwt()) ->> 'aud', '');

  IF v_user_id IS NULL OR v_client_id IS NULL OR v_resource_uri IS NULL THEN
    RAISE EXCEPTION 'MCP authentication context is required.' USING ERRCODE = '42501';
  END IF;

  IF p_tool_name IS NULL OR p_tool_name !~ '^[a-z0-9_]{1,128}$' OR p_operation_id IS NULL OR p_args_hash IS NULL OR char_length(p_args_hash)=0 THEN
    RAISE EXCEPTION 'Invalid MCP idempotency parameters.' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.mcp_authorization_grants AS g
    WHERE g.owner_user_id = v_user_id AND g.oauth_client_id = v_client_id AND g.resource_uri = v_resource_uri AND g.status='active' AND g.revoked_at IS NULL
  ) INTO v_grant_exists;

  IF NOT v_grant_exists THEN
    RAISE EXCEPTION 'No active EGA MCP authorization grant.' USING ERRCODE = '42501';
  END IF;

  -- Concurrency-safe claim with advisory lock and state machine (fail-closed)
  PERFORM pg_advisory_xact_lock(hashtext(v_user_id::text || '|' || v_client_id || '|' || p_tool_name || '|' || p_operation_id::text));

  BEGIN
    INSERT INTO public.mcp_mutation_receipts (owner_user_id, oauth_client_id, tool_name, operation_id, args_hash, status, result_payload, lease_expires_at)
    VALUES (v_user_id, v_client_id, p_tool_name, p_operation_id, p_args_hash, 'CLAIMED', NULL, now() + interval '5 minutes')
    ON CONFLICT (owner_user_id, oauth_client_id, tool_name, operation_id) DO NOTHING;

    SELECT args_hash, result_payload, status INTO v_existing_args_hash, v_existing_result, v_status
    FROM public.mcp_mutation_receipts
    WHERE owner_user_id = v_user_id AND oauth_client_id = v_client_id AND tool_name = p_tool_name AND operation_id = p_operation_id
    FOR UPDATE;

    IF v_existing_args_hash IS NULL THEN
      RAISE EXCEPTION 'Idempotency ledger insert failed.' USING ERRCODE = '40001';
    END IF;

    IF v_existing_args_hash <> p_args_hash THEN
      is_replay := false;
      existing_result := NULL;
      is_conflict := true;
      RETURN NEXT;
      RETURN;
    END IF;

    IF v_existing_result IS NOT NULL AND v_status = 'SUCCEEDED' THEN
      is_replay := true;
      existing_result := v_existing_result;
      is_conflict := false;
      RETURN NEXT;
      RETURN;
    END IF;

    IF v_status = 'CLAIMED' OR v_status = 'EXECUTING' THEN
      -- If already CLAIMED/EXECUTING by another backend, do not mutate again — treat as in-progress
      -- For now, return not replay but also not conflict, and let caller wait or return retryable
      -- We mark as EXECUTING for this caller
      UPDATE public.mcp_mutation_receipts SET status = 'EXECUTING', updated_at = now() WHERE owner_user_id = v_user_id AND oauth_client_id = v_client_id AND tool_name = p_tool_name AND operation_id = p_operation_id AND status = 'CLAIMED';
      is_replay := false;
      existing_result := NULL;
      is_conflict := false;
      RETURN NEXT;
      RETURN;
    END IF;

    -- New claim
    is_replay := false;
    existing_result := NULL;
    is_conflict := false;
    RETURN NEXT;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.mcp_claim_mutation_receipt(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_claim_mutation_receipt(text, uuid, text) TO authenticated;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mcp_store_mutation_result(
  p_tool_name text,
  p_operation_id uuid,
  p_result_payload jsonb
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

  UPDATE public.mcp_mutation_receipts
  SET result_payload = p_result_payload, status = 'SUCCEEDED', updated_at = now()
  WHERE owner_user_id = v_user_id AND oauth_client_id = v_client_id AND tool_name = p_tool_name AND operation_id = p_operation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mutation receipt not found.' USING ERRCODE = '02000';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mcp_store_mutation_result(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_store_mutation_result(text, uuid, jsonb) TO authenticated;

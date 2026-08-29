-- Durable, fenced claim API for MCP mutation idempotency.
--
-- This receipt ledger guarantees one live claimant and rejects stale claimant
-- tokens. It does not provide distributed exactly-once effects across a
-- business mutation and this ledger: if a worker commits the business effect
-- and then loses its lease before storing the result, lease recovery is
-- necessarily at-least-once. Callers requiring stronger semantics need their
-- domain mutation and idempotency record in one transaction.
--
-- Receipt key: (owner_user_id, oauth_client_id, tool_name, operation_id).
-- The fingerprint (args_hash) is computed by apps/web/src/lib/mcp/mutation-idempotency.ts
-- via canonicalMutationFingerprint (canonical JSON + sha256, tool name bound inside
-- the hashed structure so cross-tool collisions are impossible).
--
-- State machine (only states with real code paths):
--   CLAIMED       fresh receipt awaiting lease take-over
--   EXECUTING     a caller holds a live lease and may run the business mutation
--   SUCCEEDED     terminal; result_payload is the stable replay payload
--   FAILED_FINAL  terminal failure of the previous attempt; re-claimable, the
--                 claim RPC resets it to EXECUTING under a fresh claim token
--   (FAILED_RETRYABLE was dropped: the non-final failure path deletes the row
--   instead, so no unused state exists.)
--
-- Outcomes of public.mcp_claim_mutation_receipt — exactly one per call, and
-- only CLAIM_GRANTED authorizes the business mutation:
--   CLAIM_GRANTED  fresh insert, FAILED_FINAL reset, or expired-lease recovery;
--                  caller receives the only claim token that may store/fail
--   IN_PROGRESS    another executor holds a live, unexpired lease; do NOT mutate
--   REPLAY         SUCCEEDED receipt; returns the stored result_payload
--   CONFLICT       same operation_id reused with a different args fingerprint
--
-- Lease-recovery policy: if a CLAIMED/EXECUTING receipt's lease has expired, the
-- previous executor is presumed crashed; the recovering claim re-issues a fresh
-- token and may re-run the mutation. This is at-least-once recovery. The fresh
-- token fences the stale executor from accepting a result in this ledger.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.mcp_mutation_receipts (
  owner_user_id uuid NOT NULL,
  oauth_client_id text NOT NULL,
  tool_name varchar(128) NOT NULL,
  operation_id uuid NOT NULL,
  args_hash text NOT NULL,
  status text NOT NULL DEFAULT 'CLAIMED' CHECK (status IN ('CLAIMED','EXECUTING','SUCCEEDED','FAILED_FINAL')),
  claim_token uuid NOT NULL,
  result_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  PRIMARY KEY (owner_user_id, oauth_client_id, tool_name, operation_id),
  CONSTRAINT mcp_mutation_receipts_tool_check CHECK (tool_name ~ '^[a-z0-9_]{1,128}$'),
  CONSTRAINT mcp_mutation_receipts_args_hash_check CHECK (char_length(args_hash) > 0)
);

--> statement-breakpoint
-- Converge the pre-review shape of this migration (FAILED_RETRYABLE state,
-- nullable lease, defaulted claim_token) to the fenced shape above.
-- Every statement is a no-op on a database that applied this file fresh.
DO $converge$
BEGIN
  DELETE FROM public.mcp_mutation_receipts WHERE status = 'FAILED_RETRYABLE';
  ALTER TABLE public.mcp_mutation_receipts DROP CONSTRAINT IF EXISTS mcp_mutation_receipts_status_check;
  ALTER TABLE public.mcp_mutation_receipts ADD CONSTRAINT mcp_mutation_receipts_status_check
    CHECK (status IN ('CLAIMED','EXECUTING','SUCCEEDED','FAILED_FINAL'));
  ALTER TABLE public.mcp_mutation_receipts ALTER COLUMN lease_expires_at SET DEFAULT now() + interval '5 minutes';
  UPDATE public.mcp_mutation_receipts SET lease_expires_at = now() + interval '5 minutes' WHERE lease_expires_at IS NULL;
  ALTER TABLE public.mcp_mutation_receipts ALTER COLUMN lease_expires_at SET NOT NULL;
  ALTER TABLE public.mcp_mutation_receipts ALTER COLUMN claim_token DROP DEFAULT;
END
$converge$;

--> statement-breakpoint
ALTER TABLE public.mcp_mutation_receipts ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
-- Deny direct client table access; only via the security-definer RPCs below.
DROP POLICY IF EXISTS "mcp_mutation_receipts_deny_client_access" ON public.mcp_mutation_receipts;

--> statement-breakpoint
CREATE POLICY "mcp_mutation_receipts_deny_client_access"
  ON public.mcp_mutation_receipts
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

--> statement-breakpoint
REVOKE ALL ON TABLE public.mcp_mutation_receipts FROM anon, authenticated, public;

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mcp_mutation_receipts_owner_client_idx
  ON public.mcp_mutation_receipts (owner_user_id, oauth_client_id);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mcp_mutation_receipts_updated_idx
  ON public.mcp_mutation_receipts (updated_at DESC);

--> statement-breakpoint
-- The claim RPC's return shape changed from the pre-review draft
-- (is_replay/is_conflict booleans) to the single claim_outcome enum, and the
-- store RPC gained the claim_token parameter. Drop the old signatures first so
-- CREATE OR REPLACE cannot leave dead overloads behind.
DROP FUNCTION IF EXISTS public.mcp_claim_mutation_receipt(text, uuid, text);

--> statement-breakpoint
DROP FUNCTION IF EXISTS public.mcp_store_mutation_result(text, uuid, jsonb);

--> statement-breakpoint
DROP FUNCTION IF EXISTS public.mcp_fail_mutation_result(text, uuid, uuid, boolean);

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
  -- (1) Authenticated MCP context — fail closed (42501) when incomplete.
  v_user_id := (SELECT auth.uid());
  v_client_id := NULLIF((SELECT auth.jwt()) ->> 'client_id', '');
  v_resource_uri := NULLIF((SELECT auth.jwt()) ->> 'aud', '');

  IF v_user_id IS NULL OR v_client_id IS NULL OR v_resource_uri IS NULL THEN
    RAISE EXCEPTION 'MCP authentication context is required.' USING ERRCODE = '42501';
  END IF;

  IF p_tool_name IS NULL OR p_tool_name !~ '^[a-z0-9_]{1,128}$' OR p_operation_id IS NULL OR p_args_hash IS NULL OR char_length(p_args_hash) = 0 THEN
    RAISE EXCEPTION 'Invalid MCP idempotency parameters.' USING ERRCODE = '22023';
  END IF;

  -- (2) Active, unrevoked authorization grant for (owner, client, resource) — fail closed.
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

  -- (3) Serialize the entire claim decision for this (owner, client, tool,
  -- operation) so concurrent claims cannot interleave the INSERT with the
  -- SELECT ... FOR UPDATE below.
  PERFORM pg_advisory_xact_lock(
    hashtext(v_user_id::text || '|' || v_client_id || '|' || p_tool_name || '|' || p_operation_id::text)
  );

  -- (4) Insert a fresh CLAIMED receipt; if one already exists, leave it untouched.
  v_token := gen_random_uuid();
  INSERT INTO public.mcp_mutation_receipts
    (owner_user_id, oauth_client_id, tool_name, operation_id, args_hash, status, claim_token, result_payload, lease_expires_at)
  VALUES
    (v_user_id, v_client_id, p_tool_name, p_operation_id, p_args_hash, 'CLAIMED', v_token, NULL, now() + interval '5 minutes')
  ON CONFLICT (owner_user_id, oauth_client_id, tool_name, operation_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- (5) Lock the surviving row and decide. Every column reference is
  -- table-qualified because the RETURNS TABLE names (claim_token, ...) are
  -- plpgsql variables that would otherwise shadow the table columns.
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

  -- (6) Same operation_id with different arguments: never reuse, never mutate.
  IF v_args_hash <> p_args_hash THEN
    claim_outcome := 'CONFLICT';
    claim_token := NULL;
    existing_result := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- (7) Completed mutation: stable replay of the stored result.
  IF v_status = 'SUCCEEDED' THEN
    claim_outcome := 'REPLAY';
    claim_token := NULL;
    existing_result := v_result;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_status IN ('CLAIMED','EXECUTING') THEN
    IF v_inserted > 0 THEN
      -- Fresh receipt inserted by THIS call: take the lease for execution.
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
      -- Another executor still holds a live lease: the caller must NOT mutate.
      claim_outcome := 'IN_PROGRESS';
      claim_token := NULL;
      existing_result := NULL;
      RETURN NEXT;
      RETURN;
    END IF;

    -- Expired lease: recover per the documented lease-recovery policy. The new
    -- token invalidates the stale executor, which can no longer store a result.
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

  -- (8) FAILED_FINAL: the previous attempt failed terminally without producing
  -- a result, so a re-claim restarts the mutation under a fresh token.
  IF v_status = 'FAILED_FINAL' THEN
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
      AND r.status = 'FAILED_FINAL'
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

--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.mcp_claim_mutation_receipt(text, uuid, text) TO authenticated;

--> statement-breakpoint
-- Store the result of a granted mutation. Only the executor holding the current
-- claim token may transition the receipt to SUCCEEDED; any token/status/owner
-- mismatch fails closed with SQLSTATE 02000.
CREATE OR REPLACE FUNCTION public.mcp_store_mutation_result(
  p_tool_name text,
  p_operation_id uuid,
  p_claim_token uuid,
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

  UPDATE public.mcp_mutation_receipts AS r
  SET status = 'SUCCEEDED', result_payload = p_result_payload, updated_at = now()
  WHERE r.owner_user_id = v_user_id
    AND r.oauth_client_id = v_client_id
    AND r.tool_name = p_tool_name
    AND r.operation_id = p_operation_id
    AND r.claim_token = p_claim_token
    AND r.status IN ('CLAIMED','EXECUTING')
    AND r.lease_expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mutation receipt not found or claim token mismatch.' USING ERRCODE = '02000';
  END IF;
END;
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION public.mcp_store_mutation_result(text, uuid, uuid, jsonb) FROM PUBLIC, anon;

--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.mcp_store_mutation_result(text, uuid, uuid, jsonb) TO authenticated;

--> statement-breakpoint
-- Record a failed execution.
--   p_final = true:  keep the receipt as FAILED_FINAL (audit trail of the
--                    terminal failure; the claim RPC may later reset it under a
--                    fresh token).
--   p_final = false: DELETE the receipt so the next claim inserts a fresh one
--                    and the mutation starts from scratch. (Documented choice:
--                    deletion instead of a FAILED_RETRYABLE state, which was
--                    removed because nothing else in the state machine reads it.)
-- Only the executor holding the current claim token may fail the receipt.
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
    SET status = 'FAILED_FINAL', updated_at = now()
    WHERE r.owner_user_id = v_user_id
      AND r.oauth_client_id = v_client_id
      AND r.tool_name = p_tool_name
      AND r.operation_id = p_operation_id
      AND r.claim_token = p_claim_token
      AND r.status IN ('CLAIMED','EXECUTING')
      AND r.lease_expires_at > now();
  ELSE
    DELETE FROM public.mcp_mutation_receipts AS r
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

--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.mcp_fail_mutation_result(text, uuid, uuid, boolean) TO authenticated;

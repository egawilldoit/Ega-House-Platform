-- Distributed fixed-window MCP rate limiting.
--
-- The table is never exposed through PostgREST. Authenticated MCP clients can
-- only consume allowance through the security-definer function, which derives
-- user, client, and resource identity from the verified JWT.

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.mcp_rate_limit_windows (
  owner_user_id uuid NOT NULL,
  oauth_client_id text NOT NULL,
  tool_name varchar(128) NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, oauth_client_id, tool_name),
  CONSTRAINT mcp_rate_limit_windows_count_check
    CHECK (request_count >= 0),
  CONSTRAINT mcp_rate_limit_windows_tool_check
    CHECK (tool_name ~ '^[a-z0-9_]{1,128}$')
);

ALTER TABLE public.mcp_rate_limit_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mcp_rate_limit_windows
  FROM anon, authenticated, public;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.consume_mcp_rate_limit(
  p_tool_name text,
  p_limit integer DEFAULT 120,
  p_window_seconds integer DEFAULT 60
)
RETURNS TABLE (
  allowed boolean,
  retry_after_seconds integer
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
  v_now timestamptz;
  v_window timestamptz;
  v_count integer;
  v_grant_exists boolean;
BEGIN
  v_user_id := auth.uid();
  v_client_id := NULLIF(auth.jwt() ->> 'client_id', '');
  v_resource_uri := NULLIF(auth.jwt() ->> 'aud', '');

  IF v_user_id IS NULL
    OR v_client_id IS NULL
    OR v_resource_uri IS NULL THEN
    RAISE EXCEPTION 'MCP authentication context is required.'
      USING ERRCODE = '42501';
  END IF;

  IF p_tool_name IS NULL
    OR p_tool_name !~ '^[a-z0-9_]{1,128}$'
    OR p_limit < 1
    OR p_limit > 10000
    OR p_window_seconds < 1
    OR p_window_seconds > 3600 THEN
    RAISE EXCEPTION 'Invalid MCP rate-limit parameters.'
      USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.mcp_authorization_grants AS grant_record
    WHERE grant_record.owner_user_id = v_user_id
      AND grant_record.oauth_client_id = v_client_id
      AND grant_record.resource_uri = v_resource_uri
      AND grant_record.status = 'active'
      AND grant_record.revoked_at IS NULL
  ) INTO v_grant_exists;

  IF NOT v_grant_exists THEN
    RAISE EXCEPTION 'No active EGA MCP authorization grant.'
      USING ERRCODE = '42501';
  END IF;

  v_now := clock_timestamp();
  v_window := to_timestamp(
    floor(extract(epoch FROM v_now) / p_window_seconds)
    * p_window_seconds
  );

  INSERT INTO public.mcp_rate_limit_windows AS rate_window (
    owner_user_id,
    oauth_client_id,
    tool_name,
    window_started_at,
    request_count,
    updated_at
  ) VALUES (
    v_user_id,
    v_client_id,
    p_tool_name,
    v_window,
    1,
    v_now
  )
  ON CONFLICT (owner_user_id, oauth_client_id, tool_name)
  DO UPDATE SET
    window_started_at = EXCLUDED.window_started_at,
    request_count = CASE
      WHEN rate_window.window_started_at = EXCLUDED.window_started_at
        THEN rate_window.request_count + 1
      ELSE 1
    END,
    updated_at = v_now
  RETURNING request_count INTO v_count;

  allowed := v_count <= p_limit;
  retry_after_seconds := CASE
    WHEN allowed THEN 0
    ELSE GREATEST(
      1,
      CEIL(
        EXTRACT(
          epoch FROM (
            v_window
            + make_interval(secs => p_window_seconds)
            - v_now
          )
        )
      )::integer
    )
  END;

  RETURN NEXT;
END;
$$;

REVOKE ALL
  ON FUNCTION public.consume_mcp_rate_limit(text, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE
  ON FUNCTION public.consume_mcp_rate_limit(text, integer, integer)
  TO authenticated;

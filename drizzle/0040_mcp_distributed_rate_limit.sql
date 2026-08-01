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
  current_user_id uuid;
  current_client_id text;
  current_resource_uri text;
  current_time timestamptz;
  current_window timestamptz;
  current_count integer;
  grant_exists boolean;
BEGIN
  current_user_id := auth.uid();
  current_client_id := NULLIF(auth.jwt() ->> 'client_id', '');
  current_resource_uri := NULLIF(auth.jwt() ->> 'aud', '');

  IF current_user_id IS NULL
    OR current_client_id IS NULL
    OR current_resource_uri IS NULL THEN
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
    WHERE grant_record.owner_user_id = current_user_id
      AND grant_record.oauth_client_id = current_client_id
      AND grant_record.resource_uri = current_resource_uri
      AND grant_record.status = 'active'
      AND grant_record.revoked_at IS NULL
  ) INTO grant_exists;

  IF NOT grant_exists THEN
    RAISE EXCEPTION 'No active EGA MCP authorization grant.'
      USING ERRCODE = '42501';
  END IF;

  current_time := clock_timestamp();
  current_window := to_timestamp(
    floor(extract(epoch FROM current_time) / p_window_seconds)
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
    current_user_id,
    current_client_id,
    p_tool_name,
    current_window,
    1,
    current_time
  )
  ON CONFLICT (owner_user_id, oauth_client_id, tool_name)
  DO UPDATE SET
    window_started_at = EXCLUDED.window_started_at,
    request_count = CASE
      WHEN rate_window.window_started_at = EXCLUDED.window_started_at
        THEN rate_window.request_count + 1
      ELSE 1
    END,
    updated_at = current_time
  RETURNING request_count INTO current_count;

  allowed := current_count <= p_limit;
  retry_after_seconds := CASE
    WHEN allowed THEN 0
    ELSE GREATEST(
      1,
      CEIL(
        EXTRACT(
          epoch FROM (
            current_window
            + make_interval(secs => p_window_seconds)
            - current_time
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

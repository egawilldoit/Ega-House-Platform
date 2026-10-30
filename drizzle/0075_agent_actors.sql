-- Stable agent identities and registry links (EGA-800).
--
-- EGA-784 already owns task actor attribution: scoped agent writes carry a
-- verified `x-ega-actor-agent-id` header and the `ega_task_actor()` resolver
-- snapshots the label. This migration adds an owner-scoped identity above the
-- credential and lets the resolver use that identity when a token is linked.
--
--   * `agent_actors` is presentation/identity only; it grants nothing.
--   * `agent_integration_tokens.agent_id` links a revocable credential.
--   * `agent_integration_events.agent_id` records durable audit attribution;
--     client writes cannot claim an identity.
--   * Task/status/session rows continue to use EGA-784's text `actor_agent_id`.
--     A linked token presents the actor id, so history groups by identity, not
--     by a rotating credential.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."agent_actors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid DEFAULT auth.uid() NOT NULL,
	"display_name" varchar(80) NOT NULL,
	"kind" varchar(24) NOT NULL,
	"role" varchar(64),
	"avatar_color" varchar(16) DEFAULT 'slate' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_actors_kind_check" CHECK ("kind" in ('t3', 'opencode', 'codex', 'runner', 'custom')),
	CONSTRAINT "agent_actors_avatar_color_check" CHECK ("avatar_color" in ('blue', 'violet', 'green', 'amber', 'slate', 'rose')),
	CONSTRAINT "agent_actors_display_name_check" CHECK (length(btrim("display_name")) between 1 and 80),
	CONSTRAINT "agent_actors_role_check" CHECK ("role" is null or length(btrim("role")) between 1 and 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_actors_owner_name_unique"
  ON "public"."agent_actors" USING btree ("owner_user_id", lower("display_name"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_actors_owner_created_idx"
  ON "public"."agent_actors" USING btree ("owner_user_id", "created_at" DESC);
--> statement-breakpoint
ALTER TABLE "public"."agent_actors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."agent_actors" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "agent_actors_direct_user_select" ON "public"."agent_actors";
CREATE POLICY "agent_actors_direct_user_select" ON "public"."agent_actors"
  FOR SELECT TO authenticated
  USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
--> statement-breakpoint
DROP POLICY IF EXISTS "agent_actors_direct_user_insert" ON "public"."agent_actors";
CREATE POLICY "agent_actors_direct_user_insert" ON "public"."agent_actors"
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
--> statement-breakpoint
DROP POLICY IF EXISTS "agent_actors_direct_user_update" ON "public"."agent_actors";
CREATE POLICY "agent_actors_direct_user_update" ON "public"."agent_actors"
  FOR UPDATE TO authenticated
  USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL)
  WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
--> statement-breakpoint
-- No DELETE policy: identities are archived so historical attribution stays
-- resolvable.
REVOKE ALL ON TABLE "public"."agent_actors" FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE "public"."agent_actors" TO authenticated;
--> statement-breakpoint
ALTER TABLE "public"."agent_integration_tokens"
  ADD COLUMN IF NOT EXISTS "agent_id" uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_integration_tokens_agent_id_fkey'
  ) THEN
    ALTER TABLE "public"."agent_integration_tokens"
      ADD CONSTRAINT "agent_integration_tokens_agent_id_fkey"
      FOREIGN KEY ("agent_id") REFERENCES "public"."agent_actors"("id")
      ON DELETE SET NULL;
  END IF;
END
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tokens_owner_agent_idx"
  ON "public"."agent_integration_tokens" ("owner_user_id", "agent_id");
--> statement-breakpoint
ALTER TABLE "public"."agent_integration_events"
  ADD COLUMN IF NOT EXISTS "agent_id" uuid;
ALTER TABLE "public"."agent_integration_events"
  ADD COLUMN IF NOT EXISTS "agent_label" text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_integration_events_agent_id_fkey'
  ) THEN
    ALTER TABLE "public"."agent_integration_events"
      ADD CONSTRAINT "agent_integration_events_agent_id_fkey"
      FOREIGN KEY ("agent_id") REFERENCES "public"."agent_actors"("id")
      ON DELETE SET NULL;
  END IF;
END
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_integration_events_owner_agent_created_idx"
  ON "public"."agent_integration_events" ("owner_user_id", "agent_id", "created_at" DESC);
--> statement-breakpoint
-- Client writes cannot claim an agent identity. Service-side audit inserts keep
-- the id and get a display-name snapshot from the owner's identity.
CREATE OR REPLACE FUNCTION public.sanitize_agent_event_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  resolved_label text;
BEGIN
  IF uid IS NOT NULL THEN
    NEW.agent_id := NULL;
    NEW.agent_label := NULL;
    RETURN NEW;
  END IF;

  IF NEW.agent_id IS NULL THEN
    NEW.agent_label := NULL;
    RETURN NEW;
  END IF;

  SELECT actor.display_name INTO resolved_label
  FROM public.agent_actors AS actor
  WHERE actor.id = NEW.agent_id
    AND actor.owner_user_id = NEW.owner_user_id;

  IF resolved_label IS NULL THEN
    NEW.agent_id := NULL;
    NEW.agent_label := NULL;
  ELSE
    NEW.agent_label := resolved_label;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS sanitize_agent_event_actor ON public.agent_integration_events;
CREATE TRIGGER sanitize_agent_event_actor
BEFORE INSERT ON public.agent_integration_events
FOR EACH ROW EXECUTE FUNCTION public.sanitize_agent_event_actor();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.sanitize_agent_event_actor() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sanitize_agent_event_actor() FROM anon;
--> statement-breakpoint
-- Extend EGA-784's resolver: a linked scoped-agent token sends its stable
-- identity id, so the label comes from the identity; unlinked/legacy tokens keep
-- the token-name fallback. Owner and MCP OAuth behavior is unchanged.
CREATE OR REPLACE FUNCTION public.ega_task_actor()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_claims jsonb := COALESCE((SELECT auth.jwt()), '{}'::jsonb);
  v_client_id text := NULLIF(btrim(v_claims ->> 'client_id'), '');
  v_role text := NULLIF(btrim(v_claims ->> 'role'), '');
  v_headers_text text;
  v_headers jsonb;
  v_header_kind text;
  v_header_agent text;
  v_header_label text;
  v_client_label text;
BEGIN
  IF v_uid IS NOT NULL THEN
    IF v_client_id IS NOT NULL THEN
      SELECT NULLIF(
               left(regexp_replace(btrim(grant_record.client_name), '[[:cntrl:]]', '', 'g'), 128),
               ''
             )
        INTO v_client_label
      FROM public.mcp_authorization_grants AS grant_record
      WHERE grant_record.owner_user_id = v_uid
        AND grant_record.oauth_client_id = v_client_id
      ORDER BY grant_record.created_at DESC, grant_record.id DESC
      LIMIT 1;

      RETURN jsonb_build_object(
        'actor_kind', 'agent',
        'actor_user_id', v_uid,
        'actor_agent_id', left(v_client_id, 256),
        'actor_label', COALESCE(v_client_label, left(v_client_id, 128))
      );
    END IF;

    RETURN jsonb_build_object(
      'actor_kind', 'owner',
      'actor_user_id', v_uid,
      'actor_agent_id', NULL,
      'actor_label', NULL
    );
  END IF;

  IF v_role = 'service_role' THEN
    v_headers_text := NULLIF(current_setting('request.headers', true), '');
    IF v_headers_text IS NOT NULL THEN
      v_headers := v_headers_text::jsonb;
      v_header_kind := NULLIF(btrim(v_headers ->> 'x-ega-actor-kind'), '');
      IF v_header_kind = 'agent' THEN
        v_header_agent := NULLIF(btrim(v_headers ->> 'x-ega-actor-agent-id'), '');
        IF v_header_agent IS NOT NULL
          AND v_header_agent ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN
          SELECT NULLIF(
                   left(regexp_replace(btrim(actor.display_name), '[[:cntrl:]]', '', 'g'), 128),
                   ''
                 )
            INTO v_header_label
          FROM public.agent_actors AS actor
          WHERE actor.id = v_header_agent::uuid
          LIMIT 1;

          IF v_header_label IS NULL THEN
            SELECT NULLIF(
                     left(regexp_replace(btrim(token_record.name), '[[:cntrl:]]', '', 'g'), 128),
                     ''
                   )
              INTO v_header_label
            FROM public.agent_integration_tokens AS token_record
            WHERE token_record.id = v_header_agent::uuid
            LIMIT 1;
          END IF;

          RETURN jsonb_build_object(
            'actor_kind', 'agent',
            'actor_user_id', NULL,
            'actor_agent_id', v_header_agent,
            'actor_label', COALESCE(v_header_label, v_header_agent)
          );
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'actor_kind', 'system',
    'actor_user_id', NULL,
    'actor_agent_id', NULL,
    'actor_label', NULL
  );
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ega_task_actor() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ega_task_actor() FROM anon;
REVOKE ALL ON FUNCTION public.ega_task_actor() FROM authenticated;

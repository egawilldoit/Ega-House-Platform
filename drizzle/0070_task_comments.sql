-- Task comments, mentions and reactions (EGA-783).
--
-- Writes go through SECURITY DEFINER RPCs so one transaction owns the comment,
-- its stable mentions, idempotent notification intent and the EGA-784 activity
-- entry. Product clients get SELECT only; there is no forged-history path and
-- no direct insert/update/delete policy to bypass author/owner checks.
--
-- Stable author identity: `author_ref` is `owner` or `agent:<slug(name)>`.
-- `author_token_id` is credential evidence for the write that created the row;
-- token rotation/revocation therefore cannot rewrite historical attribution.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."task_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid DEFAULT auth.uid() NOT NULL,
	"task_id" uuid NOT NULL,
	"author_kind" varchar(16) NOT NULL,
	"author_user_id" uuid,
	"author_token_id" uuid,
	"author_ref" text NOT NULL,
	"author_label" text NOT NULL,
	"body" text NOT NULL,
	"client_request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	CONSTRAINT "task_comments_author_kind_check" CHECK ("author_kind" in ('owner', 'agent')),
	CONSTRAINT "task_comments_author_ref_check" CHECK (
		("author_kind" = 'owner' and "author_ref" = 'owner')
		or ("author_kind" = 'agent' and "author_ref" ~ '^agent:[a-z0-9][a-z0-9-]{0,62}$')
	),
	CONSTRAINT "task_comments_body_length_check" CHECK (char_length("body") between 1 and 4000),
	CONSTRAINT "task_comments_request_id_check" CHECK (char_length("client_request_id") between 1 and 128)
);
--> statement-breakpoint
ALTER TABLE "public"."task_comments"
  ADD CONSTRAINT "task_comments_task_id_tasks_id_fk"
  FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "public"."task_comments"
  ADD CONSTRAINT "task_comments_author_token_id_fk"
  FOREIGN KEY ("author_token_id") REFERENCES "public"."agent_integration_tokens"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_comments_owner_request_unique"
  ON "public"."task_comments" USING btree ("owner_user_id","client_request_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_comments_owner_task_time_idx"
  ON "public"."task_comments" USING btree ("owner_user_id","task_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_comments_author_ref_idx"
  ON "public"."task_comments" USING btree ("owner_user_id","author_ref");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "public"."task_comment_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid DEFAULT auth.uid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"mention_kind" varchar(16) NOT NULL,
	"mention_ref" text NOT NULL,
	"mention_label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_comment_mentions_kind_check" CHECK ("mention_kind" in ('owner', 'agent')),
	CONSTRAINT "task_comment_mentions_ref_check" CHECK (
		("mention_kind" = 'owner' and "mention_ref" = 'owner')
		or ("mention_kind" = 'agent' and "mention_ref" ~ '^agent:[a-z0-9][a-z0-9-]{0,62}$')
	)
);
--> statement-breakpoint
ALTER TABLE "public"."task_comment_mentions"
  ADD CONSTRAINT "task_comment_mentions_comment_id_fk"
  FOREIGN KEY ("comment_id") REFERENCES "public"."task_comments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_comment_mentions_comment_ref_unique"
  ON "public"."task_comment_mentions" USING btree ("comment_id","mention_ref");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_comment_mentions_owner_idx"
  ON "public"."task_comment_mentions" USING btree ("owner_user_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "public"."task_comment_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid DEFAULT auth.uid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"actor_kind" varchar(16) NOT NULL,
	"actor_user_id" uuid,
	"actor_token_id" uuid,
	"actor_ref" text NOT NULL,
	"actor_label" text NOT NULL,
	"emoji" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_comment_reactions_actor_kind_check" CHECK ("actor_kind" in ('owner', 'agent')),
	CONSTRAINT "task_comment_reactions_actor_ref_check" CHECK (
		("actor_kind" = 'owner' and "actor_ref" = 'owner')
		or ("actor_kind" = 'agent' and "actor_ref" ~ '^agent:[a-z0-9][a-z0-9-]{0,62}$')
	),
	CONSTRAINT "task_comment_reactions_emoji_check" CHECK ("emoji" in ('👍', '👀', '✅', '🎉', '🙏', '🔥'))
);
--> statement-breakpoint
ALTER TABLE "public"."task_comment_reactions"
  ADD CONSTRAINT "task_comment_reactions_comment_id_fk"
  FOREIGN KEY ("comment_id") REFERENCES "public"."task_comments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "public"."task_comment_reactions"
  ADD CONSTRAINT "task_comment_reactions_actor_token_id_fk"
  FOREIGN KEY ("actor_token_id") REFERENCES "public"."agent_integration_tokens"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_comment_reactions_comment_actor_emoji_unique"
  ON "public"."task_comment_reactions" USING btree ("comment_id","actor_ref","emoji");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_comment_reactions_owner_comment_idx"
  ON "public"."task_comment_reactions" USING btree ("owner_user_id","comment_id");
--> statement-breakpoint

-- RLS: readable only inside the owner's own task. Parent task ownership is
-- part of the predicate, not just `owner_user_id = auth.uid()`.
ALTER TABLE "public"."task_comments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."task_comments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "task_comments_owner_select" ON "public"."task_comments";
--> statement-breakpoint
CREATE POLICY "task_comments_owner_select" ON "public"."task_comments"
  FOR SELECT TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_comments.task_id
        AND t.owner_user_id = (SELECT auth.uid())
    )
  );
--> statement-breakpoint
ALTER TABLE "public"."task_comment_mentions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."task_comment_mentions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "task_comment_mentions_owner_select" ON "public"."task_comment_mentions";
--> statement-breakpoint
CREATE POLICY "task_comment_mentions_owner_select" ON "public"."task_comment_mentions"
  FOR SELECT TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.task_comments c
      JOIN public.tasks t ON t.id = c.task_id
      WHERE c.id = task_comment_mentions.comment_id
        AND c.owner_user_id = (SELECT auth.uid())
        AND t.owner_user_id = (SELECT auth.uid())
    )
  );
--> statement-breakpoint
ALTER TABLE "public"."task_comment_reactions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."task_comment_reactions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "task_comment_reactions_owner_select" ON "public"."task_comment_reactions";
--> statement-breakpoint
CREATE POLICY "task_comment_reactions_owner_select" ON "public"."task_comment_reactions"
  FOR SELECT TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.task_comments c
      JOIN public.tasks t ON t.id = c.task_id
      WHERE c.id = task_comment_reactions.comment_id
        AND c.owner_user_id = (SELECT auth.uid())
        AND t.owner_user_id = (SELECT auth.uid())
    )
  );
--> statement-breakpoint

REVOKE ALL ON TABLE "public"."task_comments" FROM anon;
--> statement-breakpoint
REVOKE ALL ON TABLE "public"."task_comment_mentions" FROM anon;
--> statement-breakpoint
REVOKE ALL ON TABLE "public"."task_comment_reactions" FROM anon;
--> statement-breakpoint
GRANT SELECT ON TABLE "public"."task_comments" TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE "public"."task_comment_mentions" TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE "public"."task_comment_reactions" TO authenticated;
--> statement-breakpoint

-- One stable actor handle for a display name. Token rotation keeps the name, so
-- the handle and every historical row stay attributable.
CREATE OR REPLACE FUNCTION public.task_comment_actor_slug(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT left(
    btrim(
      regexp_replace(
        lower(coalesce(p_name, '')),
        '[^a-z0-9]+',
        '-',
        'g'
      ),
      '-'
    ),
    62
  )
$$;
--> statement-breakpoint

-- Validate and normalize typed mentions. Unknown agent names are rejected here,
-- so a caller cannot invent a branded recipient that the owner never configured.
CREATE OR REPLACE FUNCTION public.normalize_task_comment_mentions(
  p_owner_user_id uuid,
  p_mentions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb := '[]'::jsonb;
  v_item jsonb;
  v_kind text;
  v_ref text;
  v_label text;
  v_seen text[] := ARRAY[]::text[];
BEGIN
  IF p_mentions IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  IF jsonb_typeof(p_mentions) <> 'array' THEN
    RAISE EXCEPTION 'mentions must be an array';
  END IF;
  IF jsonb_array_length(p_mentions) > 20 THEN
    RAISE EXCEPTION 'too many mentions';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_mentions)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'invalid mention';
    END IF;

    v_kind := v_item ->> 'kind';
    v_ref := btrim(coalesce(v_item ->> 'ref', ''));

    IF v_kind = 'owner' THEN
      IF v_ref <> 'owner' THEN
        RAISE EXCEPTION 'invalid owner mention';
      END IF;
      v_label := 'Owner';
    ELSIF v_kind = 'agent' THEN
      IF v_ref !~ '^agent:[a-z0-9][a-z0-9-]{0,62}$' THEN
        RAISE EXCEPTION 'invalid agent mention';
      END IF;

      SELECT t.name
        INTO v_label
        FROM public.agent_integration_tokens t
       WHERE t.owner_user_id = p_owner_user_id
         AND t.revoked_at IS NULL
         AND coalesce(t.scopes #>> '{tasks,comment}', 'false') = 'true'
         AND ('agent:' || public.task_comment_actor_slug(t.name)) = v_ref
       ORDER BY t.created_at DESC
       LIMIT 1;

      IF v_label IS NULL THEN
        RAISE EXCEPTION 'mention actor is not authorized';
      END IF;
    ELSE
      RAISE EXCEPTION 'invalid mention kind';
    END IF;

    IF v_ref = ANY(v_seen) THEN
      CONTINUE;
    END IF;
    v_seen := array_append(v_seen, v_ref);
    v_result := v_result || jsonb_build_array(
      jsonb_build_object('kind', v_kind, 'ref', v_ref, 'label', v_label)
    );
  END LOOP;

  RETURN v_result;
END;
$$;
--> statement-breakpoint

-- Read the eligible mention recipients without exposing token hashes. Only
-- non-revoked tokens that may actually comment are listed.
CREATE OR REPLACE FUNCTION public.list_task_comment_mentions(
  p_owner_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_owner uuid;
  v_agents jsonb;
BEGIN
  IF v_uid IS NOT NULL THEN
    IF p_owner_user_id IS NOT NULL AND p_owner_user_id <> v_uid THEN
      RAISE EXCEPTION 'owner mismatch';
    END IF;
    v_owner := v_uid;
  ELSE
    v_owner := p_owner_user_id;
  END IF;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'kind', 'agent',
        'ref', 'agent:' || public.task_comment_actor_slug(t.name),
        'handle', public.task_comment_actor_slug(t.name),
        'label', t.name
      )
      ORDER BY t.name
    ),
    '[]'::jsonb
  )
    INTO v_agents
    FROM public.agent_integration_tokens t
   WHERE t.owner_user_id = v_owner
     AND t.revoked_at IS NULL
     AND coalesce(t.scopes #>> '{tasks,comment}', 'false') = 'true'
     AND public.task_comment_actor_slug(t.name) <> '';

  RETURN jsonb_build_array(
    jsonb_build_object(
      'kind', 'owner',
      'ref', 'owner',
      'handle', 'owner',
      'label', 'You (owner)'
    )
  ) || v_agents;
END;
$$;
--> statement-breakpoint

-- Posting: comment + mentions + notification intent + activity ledger in one
-- transaction. The unique (owner, client_request_id) replay returns the original
-- comment and never repeats those side effects.
CREATE OR REPLACE FUNCTION public.create_task_comment(
  p_task_id uuid,
  p_body text,
  p_client_request_id text,
  p_author_kind text,
  p_owner_user_id uuid DEFAULT NULL,
  p_author_token_id uuid DEFAULT NULL,
  p_mentions jsonb DEFAULT '[]'::jsonb
)
RETURNS public.task_comments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_owner uuid;
  v_author_ref text;
  v_author_label text;
  v_author_user_id uuid;
  v_author_token_id uuid;
  v_token record;
  v_task_title text;
  v_body text;
  v_client_request_id text;
  v_comment public.task_comments%ROWTYPE;
  v_existing public.task_comments%ROWTYPE;
  v_mentions jsonb;
  v_mention jsonb;
  v_mention_kind text;
  v_mention_ref text;
  v_mention_label text;
  v_title text;
BEGIN
  IF v_uid IS NOT NULL THEN
    IF p_owner_user_id IS NOT NULL AND p_owner_user_id <> v_uid THEN
      RAISE EXCEPTION 'owner mismatch';
    END IF;
    v_owner := v_uid;
    IF p_author_kind <> 'owner' THEN
      RAISE EXCEPTION 'invalid author for authenticated session';
    END IF;
  ELSE
    v_owner := p_owner_user_id;
    IF v_owner IS NULL THEN
      RAISE EXCEPTION 'owner mismatch';
    END IF;
    IF p_author_kind <> 'agent' THEN
      RAISE EXCEPTION 'invalid author for delegated transport';
    END IF;
  END IF;

  IF p_author_kind = 'owner' THEN
    v_author_ref := 'owner';
    v_author_label := 'Owner';
    v_author_user_id := v_owner;
    v_author_token_id := NULL;
  ELSE
    SELECT t.* INTO v_token
      FROM public.agent_integration_tokens t
     WHERE t.id = p_author_token_id
       AND t.owner_user_id = v_owner
       AND t.revoked_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'agent author not authorized';
    END IF;
    IF coalesce(v_token.scopes #>> '{tasks,comment}', 'false') <> 'true' THEN
      RAISE EXCEPTION 'agent author not authorized';
    END IF;

    v_author_ref := 'agent:' || public.task_comment_actor_slug(v_token.name);
    v_author_label := v_token.name;
    v_author_user_id := NULL;
    v_author_token_id := v_token.id;
  END IF;

  SELECT t.title
    INTO v_task_title
    FROM public.tasks t
   WHERE t.id = p_task_id
     AND t.owner_user_id = v_owner;

  IF v_task_title IS NULL THEN
    RAISE EXCEPTION 'task not found';
  END IF;

  IF p_body IS NULL THEN
    RAISE EXCEPTION 'comment body is invalid';
  END IF;
  v_body := btrim(p_body);
  IF char_length(v_body) = 0 OR char_length(v_body) > 4000 THEN
    RAISE EXCEPTION 'comment body is invalid';
  END IF;

  v_client_request_id := btrim(coalesce(p_client_request_id, ''));
  IF char_length(v_client_request_id) = 0 OR char_length(v_client_request_id) > 128 THEN
    RAISE EXCEPTION 'request id is invalid';
  END IF;

  INSERT INTO public.task_comments (
    owner_user_id, task_id, author_kind, author_user_id, author_token_id,
    author_ref, author_label, body, client_request_id
  ) VALUES (
    v_owner, p_task_id, p_author_kind, v_author_user_id, v_author_token_id,
    v_author_ref, v_author_label, v_body, v_client_request_id
  )
  ON CONFLICT (owner_user_id, client_request_id) DO NOTHING
  RETURNING * INTO v_comment;

  IF v_comment.id IS NULL THEN
    SELECT * INTO v_existing
      FROM public.task_comments c
     WHERE c.owner_user_id = v_owner
       AND c.client_request_id = v_client_request_id;

    IF v_existing.id IS NULL THEN
      RAISE EXCEPTION 'comment not found after conflict';
    END IF;
    IF v_existing.task_id <> p_task_id
       OR v_existing.author_ref <> v_author_ref
       OR v_existing.body <> v_body THEN
      RAISE EXCEPTION 'comment idempotency conflict';
    END IF;
    RETURN v_existing;
  END IF;

  v_mentions := public.normalize_task_comment_mentions(v_owner, p_mentions);

  FOR v_mention IN SELECT value FROM jsonb_array_elements(v_mentions)
  LOOP
    v_mention_kind := v_mention ->> 'kind';
    v_mention_ref := v_mention ->> 'ref';
    v_mention_label := v_mention ->> 'label';

    INSERT INTO public.task_comment_mentions (
      owner_user_id, comment_id, mention_kind, mention_ref, mention_label
    ) VALUES (
      v_owner, v_comment.id, v_mention_kind, v_mention_ref, v_mention_label
    )
    ON CONFLICT (comment_id, mention_ref) DO NOTHING;

    -- The only inbox in EGA is owner-scoped, and a mention never launches an
    -- agent or sends an external message. Self-mentions create no noise.
    IF v_mention_ref <> v_author_ref THEN
      IF v_mention_kind = 'owner' THEN
        v_title := 'You were mentioned in "' || left(v_task_title, 200) || '"';
      ELSE
        v_title := v_comment.author_label || ' mentioned @' || substring(v_mention_ref from 7) || ' in "' || left(v_task_title, 200) || '"';
      END IF;

      INSERT INTO public.notifications (
        owner_user_id, type, title, body, target_type, target_id, idempotency_key
      ) VALUES (
        v_owner,
        'task_comment_mention',
        left(v_title, 500),
        left(v_body, 280),
        'task',
        p_task_id,
        'task-comment:' || v_comment.id::text || ':' || v_mention_ref
      )
      ON CONFLICT (owner_user_id, idempotency_key) DO NOTHING;
    END IF;
  END LOOP;

  RETURN v_comment;
END;
$$;
--> statement-breakpoint

-- Replace branch-revision overloads if an environment applied an earlier
-- version of this migration before the task-path parameter was added.
DROP FUNCTION IF EXISTS public.update_task_comment(uuid, text, text, uuid, uuid, jsonb);
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.delete_task_comment(uuid, text, uuid, uuid);
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.toggle_task_comment_reaction(uuid, text, text, uuid, uuid);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.update_task_comment(
  p_comment_id uuid,
  p_body text,
  p_author_kind text,
  p_owner_user_id uuid DEFAULT NULL,
  p_author_token_id uuid DEFAULT NULL,
  p_mentions jsonb DEFAULT '[]'::jsonb,
  p_task_id uuid DEFAULT NULL
)
RETURNS public.task_comments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_owner uuid;
  v_author_ref text;
  v_comment public.task_comments%ROWTYPE;
  v_task_title text;
  v_body text;
  v_mentions jsonb;
  v_mention jsonb;
  v_mention_kind text;
  v_mention_ref text;
  v_mention_label text;
  v_title text;
BEGIN
  IF v_uid IS NOT NULL THEN
    IF p_owner_user_id IS NOT NULL AND p_owner_user_id <> v_uid THEN
      RAISE EXCEPTION 'owner mismatch';
    END IF;
    v_owner := v_uid;
    IF p_author_kind <> 'owner' THEN
      RAISE EXCEPTION 'invalid author for authenticated session';
    END IF;
    v_author_ref := 'owner';
  ELSE
    v_owner := p_owner_user_id;
    IF v_owner IS NULL THEN
      RAISE EXCEPTION 'owner mismatch';
    END IF;
    IF p_author_kind <> 'agent' THEN
      RAISE EXCEPTION 'invalid author for delegated transport';
    END IF;

    SELECT ('agent:' || public.task_comment_actor_slug(t.name))
      INTO v_author_ref
      FROM public.agent_integration_tokens t
     WHERE t.id = p_author_token_id
       AND t.owner_user_id = v_owner
       AND t.revoked_at IS NULL
       AND coalesce(t.scopes #>> '{tasks,comment}', 'false') = 'true';

    IF v_author_ref IS NULL THEN
      RAISE EXCEPTION 'agent author not authorized';
    END IF;
  END IF;

  SELECT * INTO v_comment
    FROM public.task_comments c
   WHERE c.id = p_comment_id
     AND c.owner_user_id = v_owner
   FOR UPDATE;

  IF v_comment.id IS NULL OR v_comment.author_ref <> v_author_ref THEN
    RAISE EXCEPTION 'comment not found or not owned';
  END IF;

  IF p_task_id IS NOT NULL AND v_comment.task_id <> p_task_id THEN
    RAISE EXCEPTION 'comment not found or not owned';
  END IF;

  SELECT t.title
    INTO v_task_title
    FROM public.tasks t
   WHERE t.id = v_comment.task_id
     AND t.owner_user_id = v_owner;

  IF v_task_title IS NULL THEN
    RAISE EXCEPTION 'task not found';
  END IF;

  IF p_body IS NULL THEN
    RAISE EXCEPTION 'comment body is invalid';
  END IF;
  v_body := btrim(p_body);
  IF char_length(v_body) = 0 OR char_length(v_body) > 4000 THEN
    RAISE EXCEPTION 'comment body is invalid';
  END IF;

  UPDATE public.task_comments
     SET body = v_body,
         updated_at = now(),
         edited_at = now()
   WHERE id = v_comment.id
     AND owner_user_id = v_owner
  RETURNING * INTO v_comment;

  DELETE FROM public.task_comment_mentions
   WHERE comment_id = v_comment.id
     AND owner_user_id = v_owner;

  v_mentions := public.normalize_task_comment_mentions(v_owner, p_mentions);

  FOR v_mention IN SELECT value FROM jsonb_array_elements(v_mentions)
  LOOP
    v_mention_kind := v_mention ->> 'kind';
    v_mention_ref := v_mention ->> 'ref';
    v_mention_label := v_mention ->> 'label';

    INSERT INTO public.task_comment_mentions (
      owner_user_id, comment_id, mention_kind, mention_ref, mention_label
    ) VALUES (
      v_owner, v_comment.id, v_mention_kind, v_mention_ref, v_mention_label
    )
    ON CONFLICT (comment_id, mention_ref) DO NOTHING;

    IF v_mention_ref <> v_author_ref THEN
      IF v_mention_kind = 'owner' THEN
        v_title := 'You were mentioned in "' || left(v_task_title, 200) || '"';
      ELSE
        v_title := v_comment.author_label || ' mentioned @' || substring(v_mention_ref from 7) || ' in "' || left(v_task_title, 200) || '"';
      END IF;

      INSERT INTO public.notifications (
        owner_user_id, type, title, body, target_type, target_id, idempotency_key
      ) VALUES (
        v_owner,
        'task_comment_mention',
        left(v_title, 500),
        left(v_body, 280),
        'task',
        v_comment.task_id,
        'task-comment:' || v_comment.id::text || ':' || v_mention_ref
      )
      ON CONFLICT (owner_user_id, idempotency_key) DO NOTHING;
    END IF;
  END LOOP;

  RETURN v_comment;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.delete_task_comment(
  p_comment_id uuid,
  p_author_kind text,
  p_owner_user_id uuid DEFAULT NULL,
  p_author_token_id uuid DEFAULT NULL,
  p_task_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_owner uuid;
  v_author_ref text;
  v_comment public.task_comments%ROWTYPE;
BEGIN
  IF v_uid IS NOT NULL THEN
    IF p_owner_user_id IS NOT NULL AND p_owner_user_id <> v_uid THEN
      RAISE EXCEPTION 'owner mismatch';
    END IF;
    v_owner := v_uid;
    IF p_author_kind <> 'owner' THEN
      RAISE EXCEPTION 'invalid author for authenticated session';
    END IF;
    v_author_ref := 'owner';
  ELSE
    v_owner := p_owner_user_id;
    IF v_owner IS NULL THEN
      RAISE EXCEPTION 'owner mismatch';
    END IF;
    IF p_author_kind <> 'agent' THEN
      RAISE EXCEPTION 'invalid author for delegated transport';
    END IF;

    SELECT ('agent:' || public.task_comment_actor_slug(t.name))
      INTO v_author_ref
      FROM public.agent_integration_tokens t
     WHERE t.id = p_author_token_id
       AND t.owner_user_id = v_owner
       AND t.revoked_at IS NULL
       AND coalesce(t.scopes #>> '{tasks,comment}', 'false') = 'true';

    IF v_author_ref IS NULL THEN
      RAISE EXCEPTION 'agent author not authorized';
    END IF;
  END IF;

  SELECT * INTO v_comment
    FROM public.task_comments c
   WHERE c.id = p_comment_id
     AND c.owner_user_id = v_owner
   FOR UPDATE;

  IF v_comment.id IS NULL OR v_comment.author_ref <> v_author_ref THEN
    RAISE EXCEPTION 'comment not found or not owned';
  END IF;

  IF p_task_id IS NOT NULL AND v_comment.task_id <> p_task_id THEN
    RAISE EXCEPTION 'comment not found or not owned';
  END IF;

  DELETE FROM public.task_comments
   WHERE id = v_comment.id
     AND owner_user_id = v_owner;

  RETURN true;
END;
$$;
--> statement-breakpoint

-- Toggle one actor's reaction under a per-(comment, actor) advisory lock. The
-- lock keeps concurrent toggles by the same actor deterministic and leaves every
-- other actor's rows untouched.
CREATE OR REPLACE FUNCTION public.toggle_task_comment_reaction(
  p_comment_id uuid,
  p_emoji text,
  p_actor_kind text,
  p_owner_user_id uuid DEFAULT NULL,
  p_actor_token_id uuid DEFAULT NULL,
  p_task_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_owner uuid;
  v_actor_ref text;
  v_actor_label text;
  v_actor_user_id uuid;
  v_actor_token_id uuid;
  v_token record;
  v_comment public.task_comments%ROWTYPE;
  v_exists boolean;
  v_result jsonb;
BEGIN
  IF p_emoji NOT IN ('👍', '👀', '✅', '🎉', '🙏', '🔥') THEN
    RAISE EXCEPTION 'invalid reaction';
  END IF;

  IF v_uid IS NOT NULL THEN
    IF p_owner_user_id IS NOT NULL AND p_owner_user_id <> v_uid THEN
      RAISE EXCEPTION 'owner mismatch';
    END IF;
    v_owner := v_uid;
    IF p_actor_kind <> 'owner' THEN
      RAISE EXCEPTION 'invalid actor for authenticated session';
    END IF;
    v_actor_ref := 'owner';
    v_actor_label := 'Owner';
    v_actor_user_id := v_owner;
    v_actor_token_id := NULL;
  ELSE
    v_owner := p_owner_user_id;
    IF v_owner IS NULL THEN
      RAISE EXCEPTION 'owner mismatch';
    END IF;
    IF p_actor_kind <> 'agent' THEN
      RAISE EXCEPTION 'invalid actor for delegated transport';
    END IF;

    SELECT t.* INTO v_token
      FROM public.agent_integration_tokens t
     WHERE t.id = p_actor_token_id
       AND t.owner_user_id = v_owner
       AND t.revoked_at IS NULL
       AND coalesce(t.scopes #>> '{tasks,comment}', 'false') = 'true';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'agent actor not authorized';
    END IF;

    v_actor_ref := 'agent:' || public.task_comment_actor_slug(v_token.name);
    v_actor_label := v_token.name;
    v_actor_user_id := NULL;
    v_actor_token_id := v_token.id;
  END IF;

  SELECT * INTO v_comment
    FROM public.task_comments c
   WHERE c.id = p_comment_id
     AND c.owner_user_id = v_owner;

  IF v_comment.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.tasks t
     WHERE t.id = v_comment.task_id
       AND t.owner_user_id = v_owner
  ) THEN
    RAISE EXCEPTION 'comment not found or not owned';
  END IF;

  IF p_task_id IS NOT NULL AND v_comment.task_id <> p_task_id THEN
    RAISE EXCEPTION 'comment not found or not owned';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_comment_id::text || ':' || v_actor_ref, 0)
  );

  SELECT EXISTS (
    SELECT 1 FROM public.task_comment_reactions r
     WHERE r.comment_id = p_comment_id
       AND r.owner_user_id = v_owner
       AND r.actor_ref = v_actor_ref
       AND r.emoji = p_emoji
  ) INTO v_exists;

  IF v_exists THEN
    DELETE FROM public.task_comment_reactions r
     WHERE r.comment_id = p_comment_id
       AND r.owner_user_id = v_owner
       AND r.actor_ref = v_actor_ref
       AND r.emoji = p_emoji;
  ELSE
    INSERT INTO public.task_comment_reactions (
      owner_user_id, comment_id, actor_kind, actor_user_id, actor_token_id,
      actor_ref, actor_label, emoji
    ) VALUES (
      v_owner, p_comment_id, p_actor_kind, v_actor_user_id, v_actor_token_id,
      v_actor_ref, v_actor_label, p_emoji
    );
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'emoji', summary.emoji,
        'count', summary.reaction_count,
        'reacted', summary.reacted_by_actor
      )
      ORDER BY summary.first_created
    ),
    '[]'::jsonb
  )
    INTO v_result
    FROM (
      SELECT
        r.emoji,
        count(*)::int AS reaction_count,
        bool_or(r.actor_ref = v_actor_ref) AS reacted_by_actor,
        min(r.created_at) AS first_created
      FROM public.task_comment_reactions r
     WHERE r.comment_id = p_comment_id
       AND r.owner_user_id = v_owner
     GROUP BY r.emoji
    ) AS summary;

  RETURN v_result;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.task_comment_actor_slug(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.normalize_task_comment_mentions(uuid, jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.normalize_task_comment_mentions(uuid, jsonb) FROM anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.list_task_comment_mentions(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.list_task_comment_mentions(uuid) FROM anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.create_task_comment(uuid, text, text, text, uuid, uuid, jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.create_task_comment(uuid, text, text, text, uuid, uuid, jsonb) FROM anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.update_task_comment(uuid, text, text, uuid, uuid, jsonb, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.update_task_comment(uuid, text, text, uuid, uuid, jsonb, uuid) FROM anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.delete_task_comment(uuid, text, uuid, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.delete_task_comment(uuid, text, uuid, uuid, uuid) FROM anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.toggle_task_comment_reaction(uuid, text, text, uuid, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.toggle_task_comment_reaction(uuid, text, text, uuid, uuid, uuid) FROM anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.list_task_comment_mentions(uuid) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.create_task_comment(uuid, text, text, text, uuid, uuid, jsonb) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.update_task_comment(uuid, text, text, uuid, uuid, jsonb, uuid) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.delete_task_comment(uuid, text, uuid, uuid, uuid) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.toggle_task_comment_reaction(uuid, text, text, uuid, uuid, uuid) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.list_task_comment_mentions(uuid) TO service_role;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.create_task_comment(uuid, text, text, text, uuid, uuid, jsonb) TO service_role;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.update_task_comment(uuid, text, text, uuid, uuid, jsonb, uuid) TO service_role;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.delete_task_comment(uuid, text, uuid, uuid, uuid) TO service_role;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.toggle_task_comment_reaction(uuid, text, text, uuid, uuid, uuid) TO service_role;
--> statement-breakpoint

-- EGA-784 ledger: comments are a first-class `comment` event. The trigger is
-- the single producer, and `source_event_id` makes a producer replay impossible
-- to turn into a second row. 0068 owns the event-kind contract.
CREATE OR REPLACE FUNCTION public.record_task_comment_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.task_activity_events (
    owner_user_id, task_id, actor_kind, actor_user_id, actor_agent_id,
    actor_label, event_kind, delta, source_event_id, occurred_at
  ) VALUES (
    NEW.owner_user_id,
    NEW.task_id,
    NEW.author_kind,
    NEW.author_user_id,
    CASE WHEN NEW.author_kind = 'agent' THEN NEW.author_token_id::text ELSE NULL END,
    NEW.author_label,
    'comment',
    jsonb_build_object(
      'comment_id', jsonb_build_object('to', NEW.id::text),
      'excerpt', jsonb_build_object('to', left(NEW.body, 160))
    ),
    NEW.id::text,
    NEW.created_at
  );
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS record_task_comment_activity ON public.task_comments;
--> statement-breakpoint
CREATE TRIGGER record_task_comment_activity
AFTER INSERT ON public.task_comments
FOR EACH ROW EXECUTE FUNCTION public.record_task_comment_activity();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_task_comment_activity() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_task_comment_activity() FROM anon;
--> statement-breakpoint

-- Mention notifications are a distinct in-app type; they are not reminders and
-- never imply an agent inbox or external delivery.
ALTER TABLE "public"."notifications"
  DROP CONSTRAINT IF EXISTS "notifications_type_check";
--> statement-breakpoint
ALTER TABLE "public"."notifications"
  ADD CONSTRAINT "notifications_type_check"
  CHECK ("type" in ('task_reminder', 'task_comment_mention'));

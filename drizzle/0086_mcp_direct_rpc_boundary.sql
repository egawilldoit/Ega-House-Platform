-- Preserve the direct-user and delegated-agent RPC behavior from main, while
-- denying OAuth clients domains outside the advertised MCP capability surface.
-- Function bodies below retain their original signatures, ownership checks,
-- error handling and grants; only the entry guard is added.

--> statement-breakpoint
-- Original behavior: 0065_task_subtasks.sql
CREATE OR REPLACE FUNCTION public.promote_task_subtask(
  p_subtask_id uuid,
  p_new_task_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  item record;
  parent record;
BEGIN
  IF ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL THEN
    RAISE EXCEPTION 'MCP access to this direct-user RPC is not permitted'
      USING ERRCODE = '42501';
  END IF;
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO item
  FROM public.task_subtasks
  WHERE id = p_subtask_id AND owner_user_id = uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT project_id, goal_id INTO parent
  FROM public.tasks
  WHERE id = item.task_id AND owner_user_id = uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.tasks (id, owner_user_id, project_id, goal_id, title, status, priority)
  VALUES (p_new_task_id, uid, parent.project_id, parent.goal_id, item.title, 'todo', 'medium');

  DELETE FROM public.task_subtasks WHERE id = item.id AND owner_user_id = uid;

  RETURN true;
END;
$$;

--> statement-breakpoint
-- Original behavior: 0070_task_comments.sql
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
  IF ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL THEN
    RAISE EXCEPTION 'MCP access to this direct-user RPC is not permitted'
      USING ERRCODE = '42501';
  END IF;
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
-- Original behavior: 0070_task_comments.sql
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
  IF ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL THEN
    RAISE EXCEPTION 'MCP access to this direct-user RPC is not permitted'
      USING ERRCODE = '42501';
  END IF;
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
-- Original behavior: 0070_task_comments.sql
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
  IF ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL THEN
    RAISE EXCEPTION 'MCP access to this direct-user RPC is not permitted'
      USING ERRCODE = '42501';
  END IF;
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
-- Original behavior: 0070_task_comments.sql
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
  IF ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL THEN
    RAISE EXCEPTION 'MCP access to this direct-user RPC is not permitted'
      USING ERRCODE = '42501';
  END IF;
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
-- Original behavior: 0070_task_comments.sql
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
  IF ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL THEN
    RAISE EXCEPTION 'MCP access to this direct-user RPC is not permitted'
      USING ERRCODE = '42501';
  END IF;
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
-- Original behavior: 0074_task_attachments.sql
CREATE OR REPLACE FUNCTION public.create_task_attachment_upload(
  p_task_id uuid,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_extension text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  parent_owner uuid;
  existing public.task_attachments%ROWTYPE;
  attachment_count integer;
  used_bytes bigint;
  new_id uuid := gen_random_uuid();
  new_path text;
BEGIN
  IF ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL THEN
    RAISE EXCEPTION 'MCP access to this direct-user RPC is not permitted'
      USING ERRCODE = '42501';
  END IF;
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_authenticated');
  END IF;

  IF p_task_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  IF p_file_name IS NULL OR length(btrim(p_file_name)) = 0 OR length(p_file_name) > 180 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_name');
  END IF;

  IF p_mime_type IS NULL OR p_mime_type NOT IN (
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf',
    'text/plain', 'text/markdown', 'text/csv'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_type');
  END IF;

  IF p_extension IS NULL OR p_extension !~ '^[a-z0-9]{1,10}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_type');
  END IF;

  IF p_size_bytes IS NULL OR p_size_bytes <= 0 OR p_size_bytes > 10485760 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_size');
  END IF;

  IF p_idempotency_key IS NULL
     OR length(btrim(p_idempotency_key)) < 8
     OR length(p_idempotency_key) > 128 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_request');
  END IF;

  SELECT t.owner_user_id INTO parent_owner
  FROM public.tasks t
  WHERE t.id = p_task_id;

  IF parent_owner IS NULL OR parent_owner <> uid THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  SELECT * INTO existing
  FROM public.task_attachments
  WHERE owner_user_id = uid AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF existing.task_id <> p_task_id OR existing.status = 'failed' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    END IF;

    IF existing.status = 'pending' THEN
      UPDATE public.task_attachments
      SET upload_expires_at = now() + interval '120 minutes',
          updated_at = now()
      WHERE id = existing.id;
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'id', existing.id,
      'storage_path', existing.storage_path,
      'status', existing.status,
      'reused', true
    );
  END IF;

  SELECT count(*) INTO attachment_count
  FROM public.task_attachments
  WHERE owner_user_id = uid AND task_id = p_task_id AND status IN ('pending', 'finalized');

  IF attachment_count >= 20 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'task_limit');
  END IF;

  SELECT COALESCE(sum(size_bytes), 0) INTO used_bytes
  FROM public.task_attachments
  WHERE owner_user_id = uid AND status IN ('pending', 'finalized');

  IF used_bytes + p_size_bytes > 209715200 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'owner_quota');
  END IF;

  new_path := uid::text || '/' || p_task_id::text || '/' || new_id::text || '.' || p_extension;

  BEGIN
    INSERT INTO public.task_attachments (
      id, owner_user_id, task_id, file_name, storage_path, mime_type,
      size_bytes, status, idempotency_key, upload_expires_at
    ) VALUES (
      new_id, uid, p_task_id, btrim(p_file_name), new_path, p_mime_type,
      p_size_bytes, 'pending', p_idempotency_key, now() + interval '120 minutes'
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO existing
    FROM public.task_attachments
    WHERE owner_user_id = uid AND idempotency_key = p_idempotency_key;

    IF NOT FOUND OR existing.task_id <> p_task_id THEN
      RETURN jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    END IF;

    RETURN jsonb_build_object(
      'ok', true, 'id', existing.id, 'storage_path', existing.storage_path,
      'status', existing.status, 'reused', true
    );
  END;

  RETURN jsonb_build_object(
    'ok', true, 'id', new_id, 'storage_path', new_path, 'status', 'pending', 'reused', false
  );
END;
$$;

--> statement-breakpoint
-- Original behavior: 0074_task_attachments.sql
CREATE OR REPLACE FUNCTION public.finalize_task_attachment(
  p_attachment_id uuid,
  p_size_bytes bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  attachment public.task_attachments%ROWTYPE;
  parent_owner uuid;
BEGIN
  IF ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL THEN
    RAISE EXCEPTION 'MCP access to this direct-user RPC is not permitted'
      USING ERRCODE = '42501';
  END IF;
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_authenticated');
  END IF;

  SELECT * INTO attachment
  FROM public.task_attachments
  WHERE id = p_attachment_id AND owner_user_id = uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  SELECT t.owner_user_id INTO parent_owner
  FROM public.tasks t
  WHERE t.id = attachment.task_id;

  IF parent_owner IS NULL OR parent_owner <> uid THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  IF attachment.status = 'finalized' THEN
    RETURN jsonb_build_object(
      'ok', true, 'already', true, 'id', attachment.id, 'task_id', attachment.task_id,
      'file_name', attachment.file_name, 'mime_type', attachment.mime_type,
      'size_bytes', attachment.size_bytes, 'finalized_at', attachment.finalized_at
    );
  END IF;

  IF attachment.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_pending');
  END IF;

  IF p_size_bytes IS DISTINCT FROM attachment.size_bytes THEN
    RETURN jsonb_build_object('ok', false, 'code', 'size_mismatch');
  END IF;

  UPDATE public.task_attachments
  SET status = 'finalized', finalized_at = now(), updated_at = now()
  WHERE id = attachment.id;

  RETURN jsonb_build_object(
    'ok', true, 'already', false, 'id', attachment.id, 'task_id', attachment.task_id,
    'file_name', attachment.file_name, 'mime_type', attachment.mime_type,
    'size_bytes', attachment.size_bytes, 'finalized_at', now()
  );
END;
$$;

--> statement-breakpoint
-- Original behavior: 0074_task_attachments.sql
CREATE OR REPLACE FUNCTION public.fail_task_attachment(
  p_attachment_id uuid,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
BEGIN
  IF ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL THEN
    RAISE EXCEPTION 'MCP access to this direct-user RPC is not permitted'
      USING ERRCODE = '42501';
  END IF;
  IF uid IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.task_attachments
  SET status = 'failed',
      updated_at = now()
  WHERE id = p_attachment_id
    AND owner_user_id = uid
    AND status = 'pending'
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_attachments.task_id AND t.owner_user_id = uid
    );

  RETURN FOUND;
END;
$$;

--> statement-breakpoint
-- Original behavior: 0074_task_attachments.sql
CREATE OR REPLACE FUNCTION public.delete_task_attachment(p_attachment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  attachment public.task_attachments%ROWTYPE;
  parent_owner uuid;
BEGIN
  IF ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL THEN
    RAISE EXCEPTION 'MCP access to this direct-user RPC is not permitted'
      USING ERRCODE = '42501';
  END IF;
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_authenticated');
  END IF;

  SELECT * INTO attachment
  FROM public.task_attachments
  WHERE id = p_attachment_id AND owner_user_id = uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'deleted', false);
  END IF;

  SELECT t.owner_user_id INTO parent_owner
  FROM public.tasks t
  WHERE t.id = attachment.task_id;

  IF parent_owner IS NULL OR parent_owner <> uid THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  DELETE FROM public.task_attachments WHERE id = attachment.id;

  RETURN jsonb_build_object(
    'ok', true, 'deleted', true, 'task_id', attachment.task_id,
    'storage_path', attachment.storage_path, 'file_name', attachment.file_name,
    'was_finalized', attachment.status = 'finalized'
  );
END;
$$;

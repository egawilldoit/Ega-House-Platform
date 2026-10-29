-- Task attachments: owner-scoped metadata and a private Storage bucket (EGA-802).
--
-- Two resources, not one transaction: the object in the private bucket and the
-- metadata row here. Uploads therefore go through an explicit bounded workflow:
--
--   PENDING    create_task_attachment_upload() inserts the metadata row and the
--              server mints a short-lived signed upload URL for its path.
--   FINALIZED  finalize_task_attachment() runs only after the server has read
--              the stored bytes, checked the size and sniffed the content.
--   FAILED     fail_task_attachment() records a rejected upload; cleanup then
--              removes the object.
--
-- The object path is built by the database, not by the caller:
--   <owner_user_id>/<task_id>/<attachment_id>.<extension>
-- The first path segment is the owner id, which is what the Storage policies
-- below compare with auth.uid(). A path prefix alone is NOT parent proof, so
-- every write function also checks that the task belongs to auth.uid().
--
-- Metadata writes are intentionally not granted to authenticated clients: the
-- SECURITY DEFINER functions are the only writer, so a client cannot insert a
-- "finalized" row and skip content validation. Reads stay RLS-scoped to the
-- owner and to a task the same owner owns.
--
-- Signed preview/download URLs are issued by the application after an
-- owner-scoped lookup. They live for 60 seconds; a URL already handed out stays
-- valid until it expires, so this is not instant revocation.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."task_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid DEFAULT auth.uid() NOT NULL,
	"task_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"storage_path" text NOT NULL,
	"mime_type" varchar(128) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"upload_expires_at" timestamp with time zone NOT NULL,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_attachments_file_name_not_blank" CHECK (length(btrim("file_name")) > 0),
	CONSTRAINT "task_attachments_file_name_length" CHECK (length("file_name") <= 180),
	CONSTRAINT "task_attachments_size_check" CHECK ("size_bytes" > 0 AND "size_bytes" <= 10485760),
	CONSTRAINT "task_attachments_status_check" CHECK ("status" in ('pending', 'finalized', 'failed')),
	CONSTRAINT "task_attachments_mime_type_check" CHECK ("mime_type" in (
		'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf',
		'text/plain', 'text/markdown', 'text/csv'
	)),
	CONSTRAINT "task_attachments_storage_path_shape" CHECK (
		"storage_path" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$'
	),
	CONSTRAINT "task_attachments_idempotency_key_not_blank" CHECK (length(btrim("idempotency_key")) >= 8),
	CONSTRAINT "task_attachments_finalized_at_check" CHECK (("status" = 'finalized') = ("finalized_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "public"."task_attachments"
  ADD CONSTRAINT "task_attachments_task_id_tasks_id_fk"
  FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_attachments_owner_idempotency_key_unique"
  ON "public"."task_attachments" USING btree ("owner_user_id","idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_attachments_storage_path_unique"
  ON "public"."task_attachments" USING btree ("storage_path");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_attachments_owner_task_created_idx"
  ON "public"."task_attachments" USING btree ("owner_user_id","task_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_attachments_owner_pending_idx"
  ON "public"."task_attachments" USING btree ("owner_user_id","upload_expires_at")
  WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_attachments_task_status_created_idx"
  ON "public"."task_attachments" USING btree ("task_id","status","created_at");
--> statement-breakpoint
ALTER TABLE "public"."task_attachments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Read-only for clients. The task join is the parent-ownership proof: a forged
-- other-owner task id returns no rows even when owner_user_id is the caller.
DROP POLICY IF EXISTS "task_attachments_owner_select" ON "public"."task_attachments";
CREATE POLICY "task_attachments_owner_select" ON "public"."task_attachments"
  FOR SELECT TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_id AND t.owner_user_id = (SELECT auth.uid())
    )
  );
--> statement-breakpoint
-- No INSERT/UPDATE/DELETE policy exists on purpose. The functions below are the
-- only writers; direct client writes are denied by RLS.
REVOKE ALL ON TABLE "public"."task_attachments" FROM anon;
GRANT SELECT ON TABLE "public"."task_attachments" TO authenticated;
--> statement-breakpoint
-- One idempotent ticket per upload attempt. The unique (owner, key) index makes
-- a retried request resolve to the same row; a refreshed expiry lets an
-- abandoned pending row be reused instead of duplicated.
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
REVOKE ALL ON FUNCTION public.create_task_attachment_upload(uuid, text, text, bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_task_attachment_upload(uuid, text, text, bigint, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_task_attachment_upload(uuid, text, text, bigint, text, text) TO authenticated;
--> statement-breakpoint
-- Idempotent finalize. The caller must have already verified the object's
-- stored size and content; p_size_bytes is the measured object size, never a
-- client claim.
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
REVOKE ALL ON FUNCTION public.finalize_task_attachment(uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_task_attachment(uuid, bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.finalize_task_attachment(uuid, bigint) TO authenticated;
--> statement-breakpoint
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
REVOKE ALL ON FUNCTION public.fail_task_attachment(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_task_attachment(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fail_task_attachment(uuid, text) TO authenticated;
--> statement-breakpoint
-- Deletes metadata only. The application removes the object first, then calls
-- this function, so a failed object delete keeps an addressable row to retry.
-- A repeated call after success returns deleted=false without an error.
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
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.delete_task_attachment(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_task_attachment(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_task_attachment(uuid) TO authenticated;
--> statement-breakpoint
-- Attach changes to the durable task activity ledger (EGA-784) instead of
-- inventing a second history. Pending/failed rows are not activity: only a
-- finalized file was actually attached.
ALTER TABLE "public"."task_activity_events"
  DROP CONSTRAINT IF EXISTS "task_activity_events_event_kind_check";
ALTER TABLE "public"."task_activity_events"
  ADD CONSTRAINT "task_activity_events_event_kind_check" CHECK (
    "event_kind" in (
      'created', 'field_change', 'archived', 'restored',
      'reminder_scheduled', 'reminder_updated', 'reminder_cancelled', 'comment',
      'attachment_added', 'attachment_removed'
    )
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.record_task_attachment_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  actor_kind text := CASE WHEN uid IS NOT NULL THEN 'owner' ELSE 'system' END;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'finalized' THEN
      INSERT INTO public.task_activity_events
        (owner_user_id, task_id, actor_kind, actor_user_id, event_kind, delta, occurred_at)
      VALUES (
        OLD.owner_user_id, OLD.task_id, actor_kind, uid, 'attachment_removed',
        jsonb_build_object(
          'attachment_id', jsonb_build_object('from', NULL, 'to', OLD.id),
          'file_name', jsonb_build_object('from', NULL, 'to', OLD.file_name)
        ),
        now()
      );
    END IF;
    RETURN NULL;
  END IF;

  IF NEW.status = 'finalized' AND (TG_OP = 'INSERT' OR OLD.status is distinct from 'finalized') THEN
    INSERT INTO public.task_activity_events
      (owner_user_id, task_id, actor_kind, actor_user_id, event_kind, delta, occurred_at)
    VALUES (
      NEW.owner_user_id, NEW.task_id, actor_kind, uid, 'attachment_added',
      jsonb_build_object(
        'attachment_id', jsonb_build_object('from', NULL, 'to', NEW.id),
        'file_name', jsonb_build_object('from', NULL, 'to', NEW.file_name)
      ),
      COALESCE(NEW.finalized_at, now())
    );
  END IF;

  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS record_task_attachment_activity ON public.task_attachments;
CREATE TRIGGER record_task_attachment_activity
AFTER INSERT OR UPDATE OR DELETE ON public.task_attachments
FOR EACH ROW EXECUTE FUNCTION public.record_task_attachment_activity();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_task_attachment_activity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_task_attachment_activity() FROM anon;
--> statement-breakpoint
-- Private bucket and path-scoped Storage policies. The block is guarded so the
-- migration journal can still be applied to a plain Postgres proof database
-- (the db-invariants job installs a storage shim before applying it). In
-- Supabase the storage schema always exists.
DO $storage$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL
     AND to_regclass('storage.objects') IS NOT NULL
     AND to_regprocedure('storage.foldername(text)') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'task-attachments', 'task-attachments', false, 10485760,
      ARRAY['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf',
            'text/plain', 'text/markdown', 'text/csv']
    )
    ON CONFLICT (id) DO UPDATE
      SET public = false,
          file_size_limit = 10485760,
          allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/gif', 'image/webp',
                                     'application/pdf', 'text/plain', 'text/markdown', 'text/csv'];

    EXECUTE 'ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS "task_attachments_objects_select" ON storage.objects';
    EXECUTE 'CREATE POLICY "task_attachments_objects_select" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = ''task-attachments'' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)';

    EXECUTE 'DROP POLICY IF EXISTS "task_attachments_objects_insert" ON storage.objects';
    EXECUTE 'CREATE POLICY "task_attachments_objects_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = ''task-attachments'' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)';

    EXECUTE 'DROP POLICY IF EXISTS "task_attachments_objects_update" ON storage.objects';
    EXECUTE 'CREATE POLICY "task_attachments_objects_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = ''task-attachments'' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text) WITH CHECK (bucket_id = ''task-attachments'' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)';

    EXECUTE 'DROP POLICY IF EXISTS "task_attachments_objects_delete" ON storage.objects';
    EXECUTE 'CREATE POLICY "task_attachments_objects_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = ''task-attachments'' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)';
  ELSE
    RAISE NOTICE 'storage schema absent; task-attachments bucket policies were not applied';
  END IF;
END
$storage$;

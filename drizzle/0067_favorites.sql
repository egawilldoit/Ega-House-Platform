-- Durable project/task favourites (EGA-787).
--
-- Distinct from tasks.focus_rank (Today's ranking): favourites are navigation
-- shortcuts. The polymorphic entity reference is validated against the owner at
-- the persistence boundary, so an arbitrary UUID plus the caller's owner id is
-- rejected. Star retries are idempotent through the unique key.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."favorites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid DEFAULT auth.uid() NOT NULL,
	"entity_kind" varchar(16) NOT NULL,
	"entity_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorites_entity_kind_check" CHECK ("entity_kind" in ('project', 'task')),
	CONSTRAINT "favorites_position_check" CHECK ("position" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "favorites_owner_entity_unique"
  ON "public"."favorites" USING btree ("owner_user_id","entity_kind","entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "favorites_owner_position_idx"
  ON "public"."favorites" USING btree ("owner_user_id","position");
--> statement-breakpoint
ALTER TABLE "public"."favorites" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "favorites_owner_select" ON "public"."favorites";
CREATE POLICY "favorites_owner_select" ON "public"."favorites"
  FOR SELECT TO authenticated
  USING (owner_user_id = (SELECT auth.uid()));
--> statement-breakpoint
DROP POLICY IF EXISTS "favorites_owner_insert" ON "public"."favorites";
CREATE POLICY "favorites_owner_insert" ON "public"."favorites"
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND (
      (entity_kind = 'task' AND EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.id = entity_id AND t.owner_user_id = (SELECT auth.uid())
      ))
      OR
      (entity_kind = 'project' AND EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = entity_id AND p.owner_user_id = (SELECT auth.uid())
      ))
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "favorites_owner_update" ON "public"."favorites";
CREATE POLICY "favorites_owner_update" ON "public"."favorites"
  FOR UPDATE TO authenticated
  USING (owner_user_id = (SELECT auth.uid()))
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND (
      (entity_kind = 'task' AND EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.id = entity_id AND t.owner_user_id = (SELECT auth.uid())
      ))
      OR
      (entity_kind = 'project' AND EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = entity_id AND p.owner_user_id = (SELECT auth.uid())
      ))
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "favorites_owner_delete" ON "public"."favorites";
CREATE POLICY "favorites_owner_delete" ON "public"."favorites"
  FOR DELETE TO authenticated
  USING (owner_user_id = (SELECT auth.uid()));

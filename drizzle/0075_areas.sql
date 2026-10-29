-- Areas group projects into life/work buckets (e.g. Job hunt, Gymtrack, Helm,
-- EGA Skills). One optional Area per project; no hierarchy, team or RBAC
-- concepts are introduced here.
--
-- Owner isolation:
--   * areas rows are owner-scoped both by RLS and by every data-access write.
--   * projects.area_id may only reference an Area owned by the same user. RLS
--     cannot express a cross-table ownership rule, so a trigger enforces it for
--     every write path (web, Hono/mobile, MCP) before the row is persisted.
--
-- Deletion:
--   * The foreign key is ON DELETE SET NULL, so deleting an Area detaches its
--     projects atomically in the same statement. Projects, tasks, goals and
--     historical evidence are never deleted by Area deletion.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid DEFAULT auth.uid(),
	"name" varchar(80) NOT NULL,
	"icon" varchar(32) DEFAULT 'folder' NOT NULL,
	"color" varchar(32) DEFAULT 'slate' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "areas_owner_user_id_idx" ON "public"."areas" USING btree ("owner_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "areas_owner_user_id_name_unique" ON "public"."areas" USING btree ("owner_user_id", "name");
--> statement-breakpoint
ALTER TABLE "public"."areas" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "areas_direct_user_select" ON "public"."areas";
CREATE POLICY "areas_direct_user_select" ON "public"."areas"
  FOR SELECT TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "areas_direct_user_insert" ON "public"."areas";
CREATE POLICY "areas_direct_user_insert" ON "public"."areas"
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "areas_direct_user_update" ON "public"."areas";
CREATE POLICY "areas_direct_user_update" ON "public"."areas"
  FOR UPDATE TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  )
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "areas_direct_user_delete" ON "public"."areas";
CREATE POLICY "areas_direct_user_delete" ON "public"."areas"
  FOR DELETE TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  );
--> statement-breakpoint
ALTER TABLE "public"."projects" ADD COLUMN IF NOT EXISTS "area_id" uuid;
--> statement-breakpoint
DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'projects_area_id_areas_id_fk'
      AND conrelid = 'public.projects'::regclass
  ) THEN
    ALTER TABLE "public"."projects"
      ADD CONSTRAINT "projects_area_id_areas_id_fk"
      FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END
$constraint$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_owner_user_id_area_id_idx" ON "public"."projects" USING btree ("owner_user_id", "area_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_project_area_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.area_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.areas AS area_record
    WHERE area_record.id = NEW.area_id
      AND area_record.owner_user_id = NEW.owner_user_id
  ) THEN
    RAISE EXCEPTION 'Project area must belong to the same owner.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "projects_area_owner_guard" ON "public"."projects";
CREATE TRIGGER "projects_area_owner_guard"
  BEFORE INSERT OR UPDATE OF "area_id", "owner_user_id" ON "public"."projects"
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_project_area_owner();

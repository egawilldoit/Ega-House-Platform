ALTER TABLE "task_saved_views"
  ADD COLUMN IF NOT EXISTS "definition_json" jsonb;
